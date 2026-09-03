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
import {
  ConversationBackedReservationGroupStateStore,
  RESERVATION_GROUP_STATE_TOOL_ID,
  type ReservationGroupBooking,
  type ReservationGroupState,
  type ReservationGroupStateStore,
} from "./reservation-group-state.js";
import type { AgentCoreExecutor } from "./executor.js";
import type { ModelResponder } from "./model-responder.js";
import type {
  ModelRouter,
  ModelRoutingState,
  ExecutionContext,
  ModelClarificationField,
  ModelConversationTurn,
  ToolDescriptor,
  ToolExecutionMeta,
  ToolPlan,
} from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { UsageSink } from "./usage.js";
import { validateMutationGrounding } from "./mutation-grounding.js";

export type ChatResult = {
  message: string;
  sessionId: string;
  data?: unknown;
  outcome?: "clarification";
  missing?: readonly ModelClarificationField[];
};

function modelVisibleConversation(turns: readonly ModelConversationTurn[]): ModelConversationTurn[] {
  return turns.filter((turn) => turn.toolId !== CONVERSATION_STATE_TOOL_ID && turn.toolId !== RESERVATION_GROUP_STATE_TOOL_ID).slice(-12);
}

function invalidateStaleRoomGrounding(before: ConversationState, after: ConversationState): ConversationState {
  const stayChanged = before.stay.checkIn !== after.stay.checkIn
    || before.stay.checkOut !== after.stay.checkOut
    || before.stay.guests !== after.stay.guests;
  if (!stayChanged || (after.availabilityRoomIds.length === 0 && canonicalSelectedRoomIds(after).length === 0)) return after;
  return clearStaleRoomGrounding(after);
}

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

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, 10)
    : [];
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
    || patch.selectedRoomRelation !== undefined
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


function multiToolIntent(toolId: string) {
  if (toolId === "hms.createMultiReservation") return "reservation" as const;
  if (toolId === "hms.cancelMultiReservation") return "cancellation" as const;
  return conversationIntentForTool(toolId);
}

function bookingIdsFromData(data: unknown): string[] {
  if (!isRecord(data)) return [];
  return stringList(data.bookingIds);
}

function createdBookingIdsFromData(data: unknown): string[] {
  if (!isRecord(data)) return [];
  return stringList(data.createdBookingIds);
}

function bookingIdFromData(data: unknown): string | undefined {
  if (!isRecord(data) || typeof data.bookingId !== "string") return undefined;
  const value = data.bookingId.trim();
  return value || undefined;
}

function roomIdFromData(data: unknown): string | undefined {
  if (!isRecord(data) || typeof data.roomId !== "string") return undefined;
  const value = data.roomId.trim();
  return value || undefined;
}

function roomNumberForRoomId(state: Readonly<ConversationState>, roomId: string): string | undefined {
  const room = state.availabilityRooms?.find((candidate) => candidate.id === roomId);
  return room?.roomNumber?.trim() || undefined;
}

function sameBookingGrounding(left: readonly ReservationGroupBooking[], right: readonly ReservationGroupBooking[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((booking, index) => {
    const other = right[index];
    if (!other) return false;
    return booking.bookingId === other.bookingId
      && booking.roomId === other.roomId
      && booking.roomNumber === other.roomNumber;
  });
}


export class ChatOrchestrator {
  private readonly reservationGroupState: ReservationGroupStateStore;

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
    reservationGroupState?: ReservationGroupStateStore,
  ) {
    this.reservationGroupState = reservationGroupState ?? new ConversationBackedReservationGroupStateStore(conversation);
  }

  private async persistGroupOutcome(plan: ToolPlan, data: unknown, context: ExecutionContext): Promise<void> {
    const current = await this.reservationGroupState.get(context.session.id);
    let activeBookingIds = [...current.activeBookingIds];
    let activeBookings = current.activeBookings.map((booking) => ({ ...booking }));
    let status: ReservationGroupState["status"] | undefined = current.status;

    if (plan.toolId === "hms.createMultiReservation") {
      activeBookingIds = bookingIdsFromData(data);
      const createdBookingIds = createdBookingIdsFromData(data);
      const input = isRecord(plan.input) ? plan.input : {};
      const roomIds = stringList(input.roomIds);
      const conversationState = await this.conversationState.get(context.session.id);
      const createdGrounding = createdBookingIds.map((bookingId, index): ReservationGroupBooking => {
        const roomId = roomIds[index];
        const roomNumber = roomId ? roomNumberForRoomId(conversationState, roomId) : undefined;
        return {
          bookingId,
          ...(roomId ? { roomId } : {}),
          ...(roomNumber ? { roomNumber } : {}),
        };
      });
      const createdById = new Map(createdGrounding.map((booking) => [booking.bookingId, booking]));
      const currentById = new Map(current.activeBookings.map((booking) => [booking.bookingId, booking]));
      activeBookings = activeBookingIds.map((bookingId) => createdById.get(bookingId) ?? currentById.get(bookingId) ?? { bookingId });
      if (isRecord(data) && data.outcome === "confirmed") status = "confirmed";
      else if (isRecord(data) && data.outcome === "compensation_failed") status = "compensation_failed";
      else status = undefined;
    } else if (plan.toolId === "hms.cancelMultiReservation") {
      activeBookingIds = bookingIdsFromData(data);
      activeBookings = current.activeBookings.filter((booking) => activeBookingIds.includes(booking.bookingId));
      status = activeBookingIds.length ? "partial_failure" : undefined;
    } else if (plan.toolId === "hms.cancelReservation") {
      const cancelled = isRecord(plan.input) && typeof plan.input.bookingId === "string" ? plan.input.bookingId.trim() : undefined;
      if (cancelled) {
        activeBookingIds = activeBookingIds.filter((bookingId) => bookingId !== cancelled);
        activeBookings = activeBookings.filter((booking) => booking.bookingId !== cancelled);
      }
      status = activeBookingIds.length ? current.status : undefined;
    } else if (plan.toolId === "hms.createReservation" && activeBookingIds.length === 0) {
      const bookingId = bookingIdFromData(data);
      if (bookingId) {
        const conversationState = await this.conversationState.get(context.session.id);
        const roomId = roomIdFromData(data) ?? (isRecord(plan.input) && typeof plan.input.roomId === "string" ? plan.input.roomId.trim() : "");
        const roomNumber = roomId ? roomNumberForRoomId(conversationState, roomId) : undefined;
        activeBookingIds = [bookingId];
        activeBookings = [{
          bookingId,
          ...(roomId ? { roomId } : {}),
          ...(roomNumber ? { roomNumber } : {}),
        }];
      }
    } else {
      return;
    }

    const changed = activeBookingIds.length !== current.activeBookingIds.length
      || activeBookingIds.some((value, index) => value !== current.activeBookingIds[index])
      || !sameBookingGrounding(activeBookings, current.activeBookings)
      || status !== current.status;
    await this.reservationGroupState.put(context.session.id, {
      activeBookingIds,
      activeBookings,
      revision: current.revision + (changed ? 1 : 0),
      ...(status ? { status } : {}),
    });
  }

  private async assertApprovedPlanStillGrounded(plan: ToolPlan, context: ExecutionContext): Promise<void> {
    const input = isRecord(plan.input) ? plan.input : {};
    if (plan.toolId === "hms.createMultiReservation") {
      const state = await this.conversationState.get(context.session.id);
      const approvedRoomIds = stringList(input.roomIds);
      const currentRoomIds = canonicalSelectedRoomIds(state);
      const approvedCheckIn = typeof input.checkIn === "string" ? input.checkIn : undefined;
      const approvedCheckOut = typeof input.checkOut === "string" ? input.checkOut : undefined;
      if (
        multiRoomConversationIssue(state)
        || approvedRoomIds.length < 2
        || !sameStringList(approvedRoomIds, currentRoomIds)
        || approvedCheckIn !== state.stay.checkIn
        || approvedCheckOut !== state.stay.checkOut
      ) {
        throw new CoreError("CONFLICT", "Approved multi-room plan is stale and must be confirmed again", 409);
      }
    }

    if (plan.toolId === "hms.cancelMultiReservation") {
      const group = await this.reservationGroupState.get(context.session.id);
      const approvedBookingIds = stringList(input.bookingIds);
      if (approvedBookingIds.length < 2 || !sameStringList(approvedBookingIds, group.activeBookingIds)) {
        throw new CoreError("CONFLICT", "Approved group cancellation is stale and must be confirmed again", 409);
      }
    }

    if (plan.toolId === "hms.cancelReservation") {
      const bookingId = typeof input.bookingId === "string" ? input.bookingId.trim() : "";
      const group = await this.reservationGroupState.get(context.session.id);
      if (group.activeBookingIds.length > 0 && !group.activeBookingIds.includes(bookingId)) {
        throw new CoreError("CONFLICT", "Approved reservation cancellation is stale and must be confirmed again", 409);
      }
    }
  }

  private async clarification(message: string, normalized: string, context: ExecutionContext, missing?: ModelClarificationField[]): Promise<ChatResult> {
    const conversationalContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
    const reply = await this.responder.compose({
      kind: "message",
      purpose: "clarification",
      baseMessage: message,
      userMessage: normalized,
      ...(missing?.length ? { missing } : {}),
      conversation: conversationalContext,
      context,
    });
    await this.conversation.append(context.session.id, { role: "assistant", content: reply });
    return { message: reply, sessionId: context.session.id, outcome: "clarification", missing: missing ?? [] };
  }

  private async unsupportedMultiRoom(normalized: string, context: ExecutionContext): Promise<ChatResult> {
    const conversationalContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
    const reply = await this.responder.compose({
      kind: "message",
      purpose: "unsupported",
      baseMessage: "Tengo registrada la selección de varias habitaciones. La reserva conjunta todavía no está habilitada en este runtime.",
      userMessage: normalized,
      conversation: conversationalContext,
      context,
    });
    await this.conversation.append(context.session.id, { role: "assistant", content: reply });
    return { message: reply, sessionId: context.session.id };
  }

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
    await this.persistGroupOutcome(plan, data, context);
    await this.conversation.append(context.session.id, { role: "tool", toolId: plan.toolId, content: serializeToolResult(data) });
    const groundedContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
    const message = await this.responder.compose({ toolId: plan.toolId, data, conversation: groundedContext, context });
    await this.conversation.append(context.session.id, { role: "assistant", content: message });
    return { message, sessionId: context.session.id, data };
  }

  async executeApprovedPlan(plan: ToolPlan, context: ExecutionContext, trustedMeta: ToolExecutionMeta): Promise<ChatResult> {
    if (!trustedMeta.humanApproved || !trustedMeta.approvedOperationFingerprint) throw new CoreError("FORBIDDEN", "Approved plan execution requires trusted approval metadata", 403);
    await this.assertApprovedPlanStillGrounded(plan, context);
    return this.executePlan(plan, context, trustedMeta);
  }

  async chat(message: string, context: ExecutionContext, trustedMeta: ToolExecutionMeta = {}): Promise<ChatResult> {
    const normalized = message.trim();
    if (!normalized) throw new CoreError("BAD_REQUEST", "Message is required", 400);
    if (normalized.length > this.maxMessageChars) throw new CoreError("LIMIT_EXCEEDED", "Message too long", 413);

    const currentGroup = await this.reservationGroupState.get(context.session.id);
    if (currentGroup.activeBookingIds.length > 0) await this.reservationGroupState.put(context.session.id, currentGroup);

    const priorConversation = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
    const rawPriorState = await this.conversationState.get(context.session.id);
    const priorState: ModelRoutingState = { ...rawPriorState, activeBookings: currentGroup.activeBookings.map((b) => ({ bookingId: b.bookingId, ...(b.roomNumber ? { roomNumber: b.roomNumber } : {}) })) };

    await this.conversation.append(context.session.id, { role: "user", content: normalized });
    await this.usage.record({ timestamp: context.now, tenantId: context.tenant.id, sessionId: context.session.id, kind: "message", units: 1, estimatedCostUsd: 0 });

    const tools = this.registry.descriptorsFor(context.tenant);
    await this.usage.record({ timestamp: context.now, tenantId: context.tenant.id, sessionId: context.session.id, kind: "model_route", units: 1, estimatedCostUsd: 0 });
    const route = await this.model.route(normalized, context, tools, priorConversation, priorState);
    if (route.kind === "message") {
      const semanticState = invalidateStaleRoomGrounding(rawPriorState, applyUserSemanticTurn(rawPriorState, normalized, {
        tenantId: context.tenant.id, actorId: context.actor.id, sessionId: context.session.id,
      }));
      const nextState = applyConversationStatePatch(semanticState, stripModelSemanticStatePatch(route.statePatch), { activeIntentSource: "server" });
      await this.conversationState.put(context.session.id, nextState);
      const durableNextState = await this.conversationState.get(context.session.id);
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
      const missing = bounded?.missing ?? route.missing ?? [];
      const isClarification = Boolean(bounded) || (route.purpose ?? "clarification") === "clarification";
      return { message: reply, sessionId: context.session.id, ...(isClarification ? { outcome: "clarification" as const, missing } : {}) };
    }

    const visibleTool = tools.find((tool) => tool.id === route.plan.toolId);
    if (!visibleTool) return this.clarification("No pude validar una operación permitida.", normalized, context, ["selection"]);
    if (visibleTool.risk === "read") {
      const semanticState = invalidateStaleRoomGrounding(rawPriorState, applyUserSemanticTurn(rawPriorState, normalized, { tenantId: context.tenant.id, actorId: context.actor.id, sessionId: context.session.id }));
      const readIntent = multiToolIntent(route.plan.toolId);
      const nextState = applyConversationStatePatch(semanticState, stripModelSemanticStatePatch(route.statePatch), readIntent
        ? { activeIntent: readIntent, activeIntentSource: "server" }
        : { activeIntentSource: "server" });
      await this.conversationState.put(context.session.id, nextState);
      const durableNextState = await this.conversationState.get(context.session.id);
      const issue = multiRoomConversationIssue(durableNextState);
      if (issue) { const bounded = multiRoomClarification(issue); return this.clarification(bounded.message, normalized, context, bounded.missing); }
      const planInput = enrichPlanInputFromState(route.plan.toolId, route.plan.input, durableNextState);
      const missing = missingRequiredBusinessFields(visibleTool, planInput);
      if (missing.length) return this.clarification(missingRequiredClarification(missing), normalized, context, missingRequiredClarificationFields(missing));
      return this.executePlan({ toolId: route.plan.toolId, input: planInput }, context, trustedMeta);
    }
    if (visibleTool.risk !== "write") return this.clarification("No pude validar una operación segura.", normalized, context, ["selection"]);
    const proposedGrounding = route.mutationGrounding;
    if (!proposedGrounding) return this.clarification("No pude validar referencias suficientes para preparar esa operación.", normalized, context, ["selection"]);
    const serverBookings = currentGroup.activeBookingIds.length ? currentGroup.activeBookingIds : (rawPriorState.activeBookingId ? [rawPriorState.activeBookingId] : []);
    const checkedGrounding = validateMutationGrounding(proposedGrounding, { rooms: rawPriorState.availabilityRoomIds, bookings: serverBookings, ...(rawPriorState.stay.checkIn ? { checkIn: rawPriorState.stay.checkIn } : {}), ...(rawPriorState.stay.checkOut ? { checkOut: rawPriorState.stay.checkOut } : {}) });
    if (!checkedGrounding.ok) return this.clarification("No pude validar referencias suficientes para preparar esa operación.", normalized, context, ["selection"]);
    const grounding = checkedGrounding.grounding;
    const expected = route.plan.toolId === "hms.createReservation" || route.plan.toolId === "hms.createMultiReservation" ? "reservation" : route.plan.toolId === "hms.cancelReservation" || route.plan.toolId === "hms.cancelMultiReservation" ? "cancellation" : "other";
    if (expected === "other" || grounding.kind !== expected) {
      return this.clarification("La operación no coincide con la referencia indicada.", normalized, context, ["selection"]);
    }
    if (grounding.kind === "cancellation" && grounding.scope === "single" && route.plan.toolId !== "hms.cancelReservation") {
      return this.clarification("La operación no coincide con la referencia indicada.", normalized, context, ["booking"]);
    }
    if (grounding.kind === "cancellation" && grounding.scope === "all" && route.plan.toolId !== "hms.cancelMultiReservation" && route.plan.toolId !== "hms.cancelReservation") {
      return this.clarification("La operación no coincide con la referencia indicada.", normalized, context, ["booking"]);
    }
    let planInput: unknown = route.plan.input;
    if (grounding.kind === "reservation") {
      if ((route.plan.toolId === "hms.createReservation" && grounding.roomIds.length !== 1) || (route.plan.toolId === "hms.createMultiReservation" && grounding.roomIds.length < 2)) return this.clarification("La cantidad de habitaciones no coincide con la operación.", normalized, context, ["selection"]);
      const raw = isRecord(route.plan.input) ? route.plan.input : {};
      planInput = {
        ...(grounding.roomIds.length === 1 ? { roomId: grounding.roomIds[0] } : { roomIds: grounding.roomIds }),
        checkIn: grounding.checkIn,
        checkOut: grounding.checkOut,
        ...(route.plan.toolId === "hms.createMultiReservation" && (typeof raw.notes === "string" || raw.notes === null) ? { notes: raw.notes } : {}),
      };
    }

    const groupState = await this.reservationGroupState.get(context.session.id);
    const groundedBookingIds = groupState.activeBookingIds.length > 0
      ? groupState.activeBookingIds
      : rawPriorState.activeBookingId ? [rawPriorState.activeBookingId] : [];

    if (grounding.kind === "cancellation") {
      if (groundedBookingIds.length === 0) {
        return this.clarification("¿Qué reserva querés cancelar? No tengo una reserva activa identificada en esta sesión.", normalized, context, ["booking"]);
      }

      if (grounding.scope === "all") {
        if (groundedBookingIds.length === 1) {
          planInput = { bookingId: groundedBookingIds[0] };
        } else {
          if (route.plan.toolId === "hms.cancelReservation") {
            return this.clarification("La cancelación grupal requiere la operación de grupo habilitada.", normalized, context, ["booking"]);
          }
          if (!tools.some((tool) => tool.id === "hms.cancelMultiReservation")) {
            return this.clarification("La cancelación grupal no está habilitada en este runtime. Indicame qué reserva específica querés cancelar.", normalized, context, ["booking"]);
          }
          planInput = { bookingIds: [...groundedBookingIds] };
        }
      } else if (grounding.scope === "single" && groundedBookingIds.includes(grounding.bookingId)) {
        planInput = { bookingId: grounding.bookingId };
      } else if (groundedBookingIds.length === 1) {
        return this.clarification("Indicame la reserva exacta que querés cancelar.", normalized, context, ["booking"]);
      } else {
        return this.clarification("Indicame la reserva exacta que querés cancelar.", normalized, context, ["booking"]);
      }
    }

    const plan: ToolPlan = { toolId: route.plan.toolId, input: planInput };
    if (grounding.kind === "cancellation" && grounding.scope === "all" && groundedBookingIds.length === 1) {
      if (plan.toolId !== "hms.cancelMultiReservation") plan.toolId = "hms.cancelReservation";
    }
    if (grounding.kind === "cancellation" && grounding.scope === "all" && groundedBookingIds.length > 1) {
      if (plan.toolId !== "hms.cancelMultiReservation") return this.clarification("La operación no coincide con la cancelación grupal.", normalized, context, ["booking"]);
    }
    if (grounding.kind === "cancellation" && grounding.scope === "single") plan.toolId = "hms.cancelReservation";
    const finalTool = tools.find((tool) => tool.id === plan.toolId);
    if (finalTool) {
      const missing = missingRequiredBusinessFields(finalTool, plan.input);
      if (missing.length > 0) {
        const clarification = missingRequiredClarification(missing);
        const clarificationFields = missingRequiredClarificationFields(missing);
        return this.clarification(clarification, normalized, context, clarificationFields);
      }
    }

    if (grounding.kind === "reservation") {
      const canonical = applyConversationStatePatch(rawPriorState, { checkIn: grounding.checkIn, checkOut: grounding.checkOut, selectedRoomIds: grounding.roomIds, requestedRoomCount: grounding.roomIds.length }, { semanticSource: "server", activeIntent: "reservation", activeIntentSource: "server" });
      await this.conversationState.put(context.session.id, canonical);
      const reread = await this.conversationState.get(context.session.id);
      if (reread.stay.checkIn !== grounding.checkIn || reread.stay.checkOut !== grounding.checkOut || !sameStringList(canonicalSelectedRoomIds(reread), grounding.roomIds) || multiRoomConversationIssue(reread)) return this.clarification("No pude validar referencias suficientes para preparar esa operación.", normalized, context, ["selection"]);
    }
    return this.executePlan(plan, context, trustedMeta);
  }
}
