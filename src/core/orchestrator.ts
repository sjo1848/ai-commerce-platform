import { CoreError } from "./errors.js";
import type { AuditSink } from "./audit.js";
import { serializeToolResult, type ConversationStore } from "./conversation.js";
import {
  applyConversationStatePatch,
  applyUserSemanticTurn,
  CONVERSATION_STATE_TOOL_ID,
  conversationIntentForTool,
  enrichPlanInputFromState,
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
  if (!stayChanged || (after.availabilityRoomIds.length === 0 && !after.selectedRoomId)) return after;
  const next = structuredClone(after);
  next.availabilityRoomIds = [];
  delete next.selectedRoomId;
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
    await this.conversationState.put(context.session.id, updateConversationStateFromTool(before, plan.toolId, plan.input, data));
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
    // R2.3: semantic stay facts are extracted and scope-bound by Core from the
    // current user turn before the LLM sees state. The model cannot create
    // durable dates/guest memory by replaying prose history.
    const semanticPriorState = applyUserSemanticTurn(rawPriorState, normalized, {
      tenantId: context.tenant.id,
      actorId: context.actor.id,
      sessionId: context.session.id,
    });
    // A corrected/cleared stay makes prior availability and selection stale.
    // Invalidate them before routing so a room from old dates/party size cannot
    // be carried into quote/reservation as if still grounded.
    const priorState = invalidateStaleRoomGrounding(rawPriorState, semanticPriorState);
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

    if (route.kind === "message") {
      const conversationalContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
      const reply = await this.responder.compose({
        kind: "message",
        purpose: route.purpose ?? "clarification",
        baseMessage: route.message,
        userMessage: normalized,
        ...(route.missing?.length ? { missing: route.missing } : {}),
        conversation: conversationalContext,
        context,
      });
      await this.conversation.append(context.session.id, { role: "assistant", content: reply });
      return { message: reply, sessionId: context.session.id };
    }

    const plan: ToolPlan = { toolId: route.plan.toolId, input: enrichPlanInputFromState(route.plan.toolId, route.plan.input, nextState) };
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
