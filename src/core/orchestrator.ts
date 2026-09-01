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

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function requestsWholeGroupCancellation(message: string): boolean {
  const text = normalizeText(message);
  return /\b(?:todas|todos|ambas|ambos|las dos|los dos|todo el grupo|grupo completo|cancelar todo|anular todo)\b/.test(text);
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
  return left.length === right.length && left.every((booking, index) => {
    const other = right[index];
    return Boolean(other)
      && booking.bookingId === other.bookingId
      && booking.roomId === other.roomId
      && booking.roomNumber === other.roomNumber;
  });
}

type SpecificBookingResolution =
  | { kind: "none" }
  | { kind: "match"; bookingId: string }
  | { kind: "invalid" }
  | { kind: "ambiguous" };

function resolveSpecificBookingReference(message: string, group: Readonly<ReservationGroupState>): SpecificBookingResolution {
  if (group.activeBookings.length === 0) return { kind: "none" };
  const text = normalizeText(message);
  const roomMatches = group.activeBookings.filter((booking) => {
    const roomNumber = booking.roomNumber?.trim();
    if (!roomNumber) return false;
    const escaped = roomNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^0-9])${escaped}(?:[^0-9]|$)`).test(text);
  });
  if (roomMatches.length === 1) return { kind: "match", bookingId: roomMatches[0].bookingId };
  if (roomMatches.length > 1) return { kind: "ambiguous" };

  const ordinalWords = [
    /\b(?:primera|primero|primer)\b/,
    /\b(?:segunda|segundo)\b/,
    /\b(?:tercera|tercero|tercer)\b/,
    /\b(?:cuarta|cuarto)\b/,
    /\b(?:quinta|quinto)\b/,
  ];
  const ordinalIndexes = ordinalWords
    .map((pattern, index) => pattern.test(text) ? index : -1)
    .filter((index) => index >= 0);
  if (ordinalIndexes.length === 1) {
    const booking = group.activeBookings[ordinalIndexes[0]];
    return booking ? { kind: "match", bookingId: booking.bookingId } : { kind: "invalid" };
  }
  if (ordinalIndexes.length > 1) return { kind: "ambiguous" };

  const explicitRoom = text.match(/\b(?:habitacion|room|pieza)\s*(?:n(?:ro)?\.?\s*)?(\d{1,6})\b/)
    ?? text.match(/\b(?:la|el)\s+(\d{1,4})\b/);
  if (explicitRoom) return { kind: "invalid" };
  return { kind: "none" };
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
    return { message: reply, sessionId: context.session.id };
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
    const semanticPriorState = applyUserSemanticTurn(rawPriorState, normalized, {
      tenantId: context.tenant.id,
      actorId: context.actor.id,
      sessionId: context.session.id,
    });
    const proposedPriorState = invalidateStaleRoomGrounding(rawPriorState, semanticPriorState);
    await this.conversationState.put(context.session.id, proposedPriorState);
    const priorState = await this.conversationState.get(context.session.id);

    await this.conversation.append(context.session.id, { role: "user", content: normalized });
    await this.usage.record({ timestamp: context.now, tenantId: context.tenant.id, sessionId: context.session.id, kind: "message", units: 1, estimatedCostUsd: 0 });

    const tools = this.registry.descriptorsFor(context.tenant);
    await this.usage.record({ timestamp: context.now, tenantId: context.tenant.id, sessionId: context.session.id, kind: "model_route", units: 1, estimatedCostUsd: 0 });
    const route = await this.model.route(normalized, context, tools, priorConversation, priorState);
    const routeIntent = route.kind === "tool" ? multiToolIntent(route.plan.toolId) : undefined;
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
      return this.clarification(bounded.message, normalized, context, bounded.missing);
    }

    const selectedRoomIds = canonicalSelectedRoomIds(durableNextState);
    let planToolId = route.plan.toolId;
    let planInput: unknown = enrichPlanInputFromState(route.plan.toolId, route.plan.input, durableNextState);

    if ((route.plan.toolId === "hms.createReservation" || route.plan.toolId === "hms.createMultiReservation")
      && (selectedRoomIds.length > 1 || (durableNextState.requestedRoomCount ?? 0) > 1)) {
      if (selectedRoomIds.length < 2) return this.clarification("¿Qué habitaciones querés elegir?", normalized, context, ["selection"]);
      if (!durableNextState.stay.checkIn || !durableNextState.stay.checkOut) {
        return this.clarification("¿Para qué fechas sería?", normalized, context, ["dates"]);
      }
      if (!tools.some((tool) => tool.id === "hms.createMultiReservation")) {
        return this.unsupportedMultiRoom(normalized, context);
      }
      planToolId = "hms.createMultiReservation";
      const raw = isRecord(route.plan.input) ? route.plan.input : {};
      planInput = {
        roomIds: selectedRoomIds,
        checkIn: durableNextState.stay.checkIn,
        checkOut: durableNextState.stay.checkOut,
        ...(raw.notes !== undefined ? { notes: raw.notes } : {}),
      };
    }

    const groupState = await this.reservationGroupState.get(context.session.id);
    const groundedBookingIds = groupState.activeBookingIds.length > 0
      ? groupState.activeBookingIds
      : durableNextState.activeBookingId ? [durableNextState.activeBookingId] : [];

    if (route.plan.toolId === "hms.cancelReservation" || route.plan.toolId === "hms.cancelMultiReservation") {
      if (groundedBookingIds.length === 0) {
        return this.clarification("¿Qué reserva querés cancelar? No tengo una reserva activa identificada en esta sesión.", normalized, context, ["booking"]);
      }
      if (groundedBookingIds.length === 1) {
        planToolId = "hms.cancelReservation";
        planInput = { bookingId: groundedBookingIds[0] };
      } else if (requestsWholeGroupCancellation(normalized)) {
        if (!tools.some((tool) => tool.id === "hms.cancelMultiReservation")) {
          return this.clarification("La cancelación grupal no está habilitada en este runtime. Indicame qué reserva específica querés cancelar.", normalized, context, ["booking"]);
        }
        planToolId = "hms.cancelMultiReservation";
        planInput = { bookingIds: [...groundedBookingIds] };
      } else {
        const reference = resolveSpecificBookingReference(normalized, groupState);
        if (reference.kind === "match") {
          planToolId = "hms.cancelReservation";
          planInput = { bookingId: reference.bookingId };
        } else if (reference.kind === "invalid") {
          return this.clarification("No encuentro esa habitación entre las reservas activas. Indicame cuál querés cancelar.", normalized, context, ["booking"]);
        } else if (reference.kind === "ambiguous") {
          return this.clarification("La referencia coincide con más de una reserva. Indicame una habitación específica.", normalized, context, ["booking"]);
        } else {
          const candidate = isRecord(route.plan.input) && typeof route.plan.input.bookingId === "string"
            ? route.plan.input.bookingId.trim()
            : "";
          if (candidate && groundedBookingIds.includes(candidate)) {
            planToolId = "hms.cancelReservation";
            planInput = { bookingId: candidate };
          } else {
            return this.clarification("Tenés varias reservas activas. ¿Querés cancelar una reserva específica o todas?", normalized, context, ["booking"]);
          }
        }
      }
    }

    const plan: ToolPlan = { toolId: planToolId, input: planInput };
    const visibleTool = tools.find((tool) => tool.id === plan.toolId);
    if (visibleTool) {
      const missing = missingRequiredBusinessFields(visibleTool, plan.input);
      if (missing.length > 0) {
        const clarification = missingRequiredClarification(missing);
        const clarificationFields = missingRequiredClarificationFields(missing);
        return this.clarification(clarification, normalized, context, clarificationFields);
      }
    }

    return this.executePlan(plan, context, trustedMeta);
  }
}
