import { CoreError } from "./errors.js";
import type { AuditSink } from "./audit.js";
import { serializeToolResult, type ConversationStore } from "./conversation.js";
import {
  applyConversationStatePatch,
  applyUserSemanticTurn,
  canonicalSelectedRoomIds,
  clearStaleRoomGrounding,
  CONVERSATION_STATE_TOOL_ID,
  conversationIntentForTool,
  enrichPlanInputFromState,
  multiRoomConversationIssue,
  InMemoryConversationStateStore,
  stripModelSemanticStatePatch,
  updateConversationStateFromTool,
  type ConversationState,
  type ConversationStateStore,
} from "./conversation-state.js";
import type { AgentCoreExecutor } from "./executor.js";
import type { ModelResponder } from "./model-responder.js";
import type {
  ModelRouter,
  ExecutionContext,
  ModelClarificationField,
  ModelConversationTurn,
  ToolDescriptor,
  ToolExecutionMeta,
  ToolPlan,
} from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { UsageSink } from "./usage.js";

export type ChatResult = {
  message: string;
  sessionId: string;
  data?: unknown;
};

function modelVisibleConversation(turns: readonly ModelConversationTurn[]): ModelConversationTurn[] {
  return turns.filter((turn) => turn.toolId !== CONVERSATION_STATE_TOOL_ID).slice(-12);
}

function invalidateStaleRoomGrounding(before: ConversationState, after: ConversationState): ConversationState {
  const stayChanged = before.stay.checkIn !== after.stay.checkIn
    || before.stay.checkOut !== after.stay.checkOut
    || before.stay.guests !== after.stay.guests;
  if (!stayChanged || (after.availabilityRoomIds.length === 0 && canonicalSelectedRoomIds(after).length === 0)) return after;
  return clearStaleRoomGrounding(after);
}

/**
 * Defense in depth for tool completions: explicit user values and explicit
 * clears remain authoritative over a tool plan that was prepared against older
 * conversational state. Operational results remain real/audited, but stale room
 * grounding is discarded.
 */
function preserveUserSemanticAuthority(before: ConversationState, after: ConversationState): ConversationState {
  const next = structuredClone(after);
  const beforeMemory = (before as ConversationState & { semanticMemory?: ConversationState["semanticMemory"] }).semanticMemory;
  const afterMemory = (next as ConversationState & { semanticMemory?: ConversationState["semanticMemory"] }).semanticMemory;
  if (!beforeMemory || !afterMemory) return next;

  let staleStayTool = false;
  const preserveDate = (field: "checkIn" | "checkOut") => {
    const provenance = beforeMemory.stay[field];
    if (provenance?.source !== "user") return;
    if (provenance.cleared) {
      if (next.stay[field] !== undefined) staleStayTool = true;
      delete next.stay[field];
      afterMemory.stay[field] = structuredClone(provenance);
      return;
    }
    const value = before.stay[field];
    if (value === undefined) return;
    if (next.stay[field] !== value) staleStayTool = true;
    next.stay[field] = value;
    afterMemory.stay[field] = structuredClone(provenance);
  };
  preserveDate("checkIn");
  preserveDate("checkOut");

  const guestProvenance = beforeMemory.stay.guests;
  if (guestProvenance?.source === "user") {
    if (guestProvenance.cleared) {
      if (next.stay.guests !== undefined) staleStayTool = true;
      delete next.stay.guests;
      afterMemory.stay.guests = structuredClone(guestProvenance);
    } else if (before.stay.guests !== undefined) {
      if (next.stay.guests !== before.stay.guests) staleStayTool = true;
      next.stay.guests = before.stay.guests;
      afterMemory.stay.guests = structuredClone(guestProvenance);
    }
  }

  if (staleStayTool) return clearStaleRoomGrounding(next);
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissingRequiredValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function missingRequiredBusinessFields(tool: ToolDescriptor, input: unknown): string[] {
  const required = Array.isArray(tool.inputSchema?.required)
    ? tool.inputSchema.required.filter((field): field is string => typeof field === "string")
    : [];
  if (required.length === 0) return [];
  const raw = isRecord(input) ? input : {};
  return required.filter((field) => isMissingRequiredValue(raw[field]));
}

function missingRequiredClarification(fields: readonly string[]): string {
  const missing = new Set(fields);
  const datesMissing = missing.has("checkIn") || missing.has("checkOut");
  const guestsMissing = missing.has("guests");
  const roomMissing = missing.has("roomId");
  const bookingMissing = missing.has("bookingId");

  if (datesMissing && guestsMissing) return "Necesito saber las fechas y cuántas personas son.";
  if (roomMissing && datesMissing) return "Necesito saber qué habitación elegís y para qué fechas.";
  if (datesMissing) return "¿Para qué fechas sería?";
  if (guestsMissing) return "¿Para cuántas personas sería?";
  if (roomMissing) return "¿Qué habitación u opción querés elegir?";
  if (bookingMissing) return "¿Qué reserva querés usar? Necesito identificarla de forma inequívoca.";
  return "Me falta información necesaria para continuar con seguridad.";
}

function hasMultiRoomStatePatch(patch: import("./conversation-state.js").ConversationStatePatch | undefined): boolean {
  return Boolean(patch && (
    patch.selectedRoomIds !== undefined
    || patch.selectedRoomIndexes !== undefined
    || patch.selectedRoomNumbers !== undefined
    || patch.requestedRoomCount !== undefined
    || patch.roomOccupancy !== undefined
  ));
}

function multiRoomClarification(issue: "which_rooms" | "occupancy_distribution"): { message: string; missing: ModelClarificationField[] } {
  if (issue === "occupancy_distribution") {
    return { message: "¿Cómo querés repartir la ocupación entre ellas?", missing: ["occupancy"] };
  }
  return { message: "¿Qué habitaciones querés elegir?", missing: ["selection"] };
}

function missingRequiredClarificationFields(fields: readonly string[]): ModelClarificationField[] {
  const result: ModelClarificationField[] = [];
  if (fields.includes("checkIn") || fields.includes("checkOut")) result.push("dates");
  if (fields.includes("guests")) result.push("guests");
  if (fields.includes("roomId")) result.push("room");
  if (fields.includes("bookingId")) result.push("booking");
  return result;
}

export class ChatOrchestrator {
  constructor(
    private readonly model: ModelRouter,
    private readonly responder: ModelResponder,
    private readonly registry: ToolRegistry,
    private readonly executor: AgentCoreExecutor,
    private readonly usage: UsageSink,
    private readonly audit: AuditSink,
    private readonly conversation: ConversationStore,
    private readonly conversationState: ConversationStateStore = new InMemoryConversationStateStore(),
    private readonly maxMessageChars = 2_000,
    private readonly maxToolCalls = 2,
  ) {}

  private async executePlan(plan: ToolPlan, context: ExecutionContext, trustedMeta: ToolExecutionMeta): Promise<ChatResult> {
    if (this.maxToolCalls < 1) throw new CoreError("LIMIT_EXCEEDED", "Tool-call limit reached", 429);
    const tools = this.registry.descriptorsFor(context.tenant);
    const visible = tools.some((tool) => tool.id === plan.toolId);
    if (!visible) {
      await this.audit.record({ timestamp: context.now, requestId: context.requestId, tenantId: context.tenant.id, actorId: context.actor.id, sessionId: context.session.id, toolId: plan.toolId, status: "denied", detail: "model_requested_non_visible_tool" });
      throw new CoreError("TOOL_NOT_ALLOWED", "Requested tool is not available", 403);
    }

    const data = await this.executor.execute(plan.toolId, plan.input, context, trustedMeta);
    const before = await this.conversationState.get(context.session.id);
    const toolUpdated = updateConversationStateFromTool(before, plan.toolId, plan.input, data);
    await this.conversationState.put(context.session.id, preserveUserSemanticAuthority(before, toolUpdated));
    await this.conversation.append(context.session.id, { role: "tool", toolId: plan.toolId, content: serializeToolResult(data) });
    const groundedContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
    const message = await this.responder.compose({ toolId: plan.toolId, data, conversation: groundedContext, context });
    await this.conversation.append(context.session.id, { role: "assistant", content: message });
    return { message, sessionId: context.session.id, data };
  }

  async executeApprovedPlan(plan: ToolPlan, context: ExecutionContext, trustedMeta: ToolExecutionMeta): Promise<ChatResult> {
    if (!trustedMeta.humanApproved || !trustedMeta.approvedOperationFingerprint) throw new CoreError("FORBIDDEN", "Approved plan execution requires trusted approval metadata", 403);
    return this.executePlan(plan, context, trustedMeta);
  }

  async chat(message: string, context: ExecutionContext, trustedMeta: ToolExecutionMeta = {}): Promise<ChatResult> {
    const normalized = message.trim();
    if (!normalized) throw new CoreError("BAD_REQUEST", "Message is required", 400);
    if (normalized.length > this.maxMessageChars) throw new CoreError("LIMIT_EXCEEDED", "Message too long", 413);

    const priorConversation = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
    const rawPriorState = await this.conversationState.get(context.session.id);
    // R2.3: extract and persist the current user facts before any provider call.
    // If routing times out/fails, unambiguous dates/guests/preferences still survive.
    const semanticPriorState = applyUserSemanticTurn(rawPriorState, normalized, {
      tenantId: context.tenant.id,
      actorId: context.actor.id,
      sessionId: context.session.id,
    });
    const proposedPriorState = invalidateStaleRoomGrounding(rawPriorState, semanticPriorState);
    await this.conversationState.put(context.session.id, proposedPriorState);
    // State stores merge overlapping snapshots by semantic revision. Read back the
    // durable merged view so concurrent facts are visible to this routing turn.
    const priorState = await this.conversationState.get(context.session.id);

    await this.conversation.append(context.session.id, { role: "user", content: normalized });
    await this.usage.record({ timestamp: context.now, tenantId: context.tenant.id, sessionId: context.session.id, kind: "message", units: 1, estimatedCostUsd: 0 });

    const tools = this.registry.descriptorsFor(context.tenant);
    await this.usage.record({ timestamp: context.now, tenantId: context.tenant.id, sessionId: context.session.id, kind: "model_route", units: 1, estimatedCostUsd: 0 });
    const route = await this.model.route(normalized, context, tools, priorConversation, priorState);
    const routeIntent = route.kind === "tool" ? conversationIntentForTool(route.plan.toolId) : undefined;
    const nextState = applyConversationStatePatch(priorState, stripModelSemanticStatePatch(route.statePatch), {
      ...(routeIntent ? { activeIntent: routeIntent, activeIntentSource: "server" as const } : {}),
    });
    await this.conversationState.put(context.session.id, nextState);
    const durableNextState = await this.conversationState.get(context.session.id);

    if (route.kind === "message") {
      const issue = hasMultiRoomStatePatch(route.statePatch) ? multiRoomConversationIssue(durableNextState) : undefined;
      const bounded = issue ? multiRoomClarification(issue) : undefined;
      const conversationalContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
      const reply = await this.responder.compose({
        kind: "message",
        purpose: bounded ? "clarification" : route.purpose ?? "clarification",
        baseMessage: bounded?.message ?? route.message,
        userMessage: normalized,
        ...(bounded ? { missing: bounded.missing } : route.missing?.length ? { missing: route.missing } : {}),
        conversation: conversationalContext,
        context,
      });
      await this.conversation.append(context.session.id, { role: "assistant", content: reply });
      return { message: reply, sessionId: context.session.id };
    }

    const routeIssue = multiRoomConversationIssue(durableNextState);
    if (routeIssue) {
      const bounded = multiRoomClarification(routeIssue);
      const conversationalContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
      const reply = await this.responder.compose({
        kind: "message",
        purpose: "clarification",
        baseMessage: bounded.message,
        userMessage: normalized,
        missing: bounded.missing,
        conversation: conversationalContext,
        context,
      });
      await this.conversation.append(context.session.id, { role: "assistant", content: reply });
      return { message: reply, sessionId: context.session.id };
    }

    const selectedRoomIds = canonicalSelectedRoomIds(durableNextState);
    if (route.plan.toolId === "hms.createReservation" && (selectedRoomIds.length > 1 || (durableNextState.requestedRoomCount ?? 0) > 1)) {
      const issue = multiRoomConversationIssue(durableNextState);
      const conversationalContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
      if (issue) {
        const bounded = multiRoomClarification(issue);
        const reply = await this.responder.compose({
          kind: "message", purpose: "clarification", baseMessage: bounded.message, userMessage: normalized, missing: bounded.missing, conversation: conversationalContext, context,
        });
        await this.conversation.append(context.session.id, { role: "assistant", content: reply });
        return { message: reply, sessionId: context.session.id };
      }
      const reply = await this.responder.compose({
        kind: "message",
        purpose: "unsupported",
        baseMessage: "Tengo registrada la selección de varias habitaciones. La reserva conjunta todavía no se ejecuta en esta etapa.",
        userMessage: normalized,
        conversation: conversationalContext,
        context,
      });
      await this.conversation.append(context.session.id, { role: "assistant", content: reply });
      return { message: reply, sessionId: context.session.id };
    }

    const plan: ToolPlan = { toolId: route.plan.toolId, input: enrichPlanInputFromState(route.plan.toolId, route.plan.input, durableNextState) };
    const visibleTool = tools.find((tool) => tool.id === plan.toolId);
    if (visibleTool) {
      const missing = missingRequiredBusinessFields(visibleTool, plan.input);
      if (missing.length > 0) {
        const clarification = missingRequiredClarification(missing);
        const clarificationFields = missingRequiredClarificationFields(missing);
        const conversationalContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
        const reply = await this.responder.compose({
          kind: "message",
          purpose: "clarification",
          baseMessage: clarification,
          userMessage: normalized,
          ...(clarificationFields.length ? { missing: clarificationFields } : {}),
          conversation: conversationalContext,
          context,
        });
        await this.conversation.append(context.session.id, { role: "assistant", content: reply });
        return { message: reply, sessionId: context.session.id };
      }
    }

    return this.executePlan(plan, context, trustedMeta);
  }
}
