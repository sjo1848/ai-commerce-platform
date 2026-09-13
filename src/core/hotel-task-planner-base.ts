import type { TaskStateV1 } from "./task-state.js";
import { capabilityPreconditionFingerprint, hotelCapabilityDependencyProjection } from "./planning.js";
import type {
  DeterministicPlanner,
  DomainCapability,
  GroundedReference,
  HotelCapabilityId,
  NextStep,
  PlanningContext,
  PresentationContext,
} from "./planning.js";

function capability(context: PlanningContext, id: HotelCapabilityId): DomainCapability | undefined {
  return context.capabilities[id];
}

function fingerprint(
  context: PlanningContext,
  capabilityValue: DomainCapability,
  dependencyProjection: Readonly<Record<string, unknown>>,
): string {
  return capabilityPreconditionFingerprint(context.taskDefinition, capabilityValue, dependencyProjection);
}

function callTool(
  context: PlanningContext,
  id: HotelCapabilityId,
  groundedInput: Readonly<Record<string, unknown>>,
  dependencyProjection: Readonly<Record<string, unknown>>,
  correlationIntent: string,
): NextStep {
  const selected = capability(context, id);
  if (!selected) {
    return {
      kind: "DEGRADE",
      reasonCode: `CAPABILITY_UNAVAILABLE_${id.toUpperCase()}`,
      recoverable: false,
      responseIntent: "unsupported_capability",
    };
  }
  return {
    kind: "CALL_TOOL",
    capabilityId: id,
    groundedInput,
    preconditionFingerprint: fingerprint(context, selected, dependencyProjection),
    correlationIntent,
    effectClass: selected.effectClass,
  };
}

function stayInput(state: Readonly<TaskStateV1>): { checkIn: string; checkOut: string; guests: number } | undefined {
  const checkIn = state.requestedStay.checkIn?.value;
  const checkOut = state.requestedStay.checkOut?.value;
  const guests = state.requestedStay.guests?.value;
  if (!checkIn || !checkOut || guests === undefined) return undefined;
  return { checkIn, checkOut, guests };
}

function missingStayStep(state: Readonly<TaskStateV1>): NextStep | undefined {
  const checkIn = state.requestedStay.checkIn?.value;
  const checkOut = state.requestedStay.checkOut?.value;
  const guests = state.requestedStay.guests?.value;
  if (!checkIn && !checkOut) {
    return { kind: "ASK", field: "dates", reason: "stay_dates_required", dialogueAnchorSpec: { kind: "dates" } };
  }
  if (!checkIn) {
    return { kind: "ASK", field: "check_in", reason: "check_in_required", dialogueAnchorSpec: { kind: "dates" } };
  }
  if (!checkOut) {
    return { kind: "ASK", field: "check_out", reason: "check_out_required", dialogueAnchorSpec: { kind: "check_out" } };
  }
  if (guests === undefined) {
    return { kind: "ASK", field: "guests", reason: "guests_required", dialogueAnchorSpec: { kind: "guests" } };
  }
  return undefined;
}

function availabilityProjection(state: Readonly<TaskStateV1>): Readonly<Record<string, unknown>> | undefined {
  return hotelCapabilityDependencyProjection(state, "availability");
}

function expectedFingerprint(
  context: PlanningContext,
  id: HotelCapabilityId,
  projection: Readonly<Record<string, unknown>>,
): string | undefined {
  const selected = capability(context, id);
  return selected ? fingerprint(context, selected, projection) : undefined;
}

function matchingPending(
  state: Readonly<TaskStateV1>,
  id: HotelCapabilityId,
  expected: string | undefined,
): boolean {
  return Boolean(
    expected
    && state.pendingToolInvocation?.status === "pending"
    && state.pendingToolInvocation.capabilityId === id
    && state.pendingToolInvocation.dependencyFingerprint === expected,
  );
}

function observedAvailabilityReference(state: Readonly<TaskStateV1>): GroundedReference[] {
  if (state.availability.status !== "observed" || state.availability.observationRevision === undefined) return [];
  return [{
    kind: "availability",
    observationRevision: state.availability.observationRevision,
    roomIds: state.availability.rooms.map((room) => room.roomId),
  }];
}

function selectionPresentation(state: Readonly<TaskStateV1>): PresentationContext | undefined {
  if (state.availability.status !== "observed" || state.availability.observationRevision === undefined) return undefined;
  return {
    kind: "availability_options",
    observationRevision: state.availability.observationRevision,
    roomIds: state.availability.rooms.map((room) => room.roomId),
  };
}

function askSelection(state: Readonly<TaskStateV1>, reason: string): NextStep {
  const presentationContext = selectionPresentation(state);
  const candidateRoomIds = state.availability.status === "observed"
    ? state.availability.rooms.map((room) => room.roomId)
    : [];
  return {
    kind: "ASK",
    field: "selection",
    reason,
    ...(presentationContext ? { presentationContext } : {}),
    dialogueAnchorSpec: {
      kind: "selection",
      ...(candidateRoomIds.length > 0 ? { candidateRoomIds } : {}),
      ...(state.availability.observationRevision !== undefined
        ? { referencedObservationRevision: state.availability.observationRevision }
        : {}),
    },
  };
}

function planAvailability(context: PlanningContext, retryExplicit = false): NextStep {
  const state = context.state;
  const missing = missingStayStep(state);
  if (missing) return missing;
  const input = availabilityProjection(state)!;
  const expected = expectedFingerprint(context, "availability", input);
  if (!expected) {
    return { kind: "DEGRADE", reasonCode: "CAPABILITY_UNAVAILABLE_AVAILABILITY", recoverable: false, responseIntent: "unsupported_capability" };
  }
  if (matchingPending(state, "availability", expected)) {
    return { kind: "WAIT", reason: "tool_pending", ...(state.pendingToolInvocation ? { correlationId: state.pendingToolInvocation.invocationId } : {}) };
  }
  if (state.pendingToolInvocation?.status === "pending") {
    return { kind: "WAIT", reason: "tool_pending", correlationId: state.pendingToolInvocation.invocationId };
  }
  if (state.availability.status === "observed" && state.availability.dependencyFingerprint === expected) {
    if (state.availability.rooms.length === 0) {
      return { kind: "RESPOND", responseIntent: "no_availability", groundedReferences: observedAvailabilityReference(state) };
    }
    return { kind: "RESPOND", responseIntent: "availability_result", groundedReferences: observedAvailabilityReference(state) };
  }
  if (state.availability.status === "failed" && state.availability.dependencyFingerprint === expected && !retryExplicit) {
    return { kind: "DEGRADE", reasonCode: "AVAILABILITY_FAILED", recoverable: true, responseIntent: "availability_failed" };
  }
  return callTool(context, "availability", input, input, retryExplicit ? "retry_availability" : "check_availability");
}

function currentAvailability(context: PlanningContext): boolean {
  const projection = availabilityProjection(context.state);
  if (!projection) return false;
  const expected = expectedFingerprint(context, "availability", projection);
  return context.state.availability.status === "observed"
    && expected !== undefined
    && context.state.availability.dependencyFingerprint === expected;
}

function quoteProjection(state: Readonly<TaskStateV1>): Readonly<Record<string, unknown>> | undefined {
  return hotelCapabilityDependencyProjection(state, "quote");
}

function planQuote(context: PlanningContext, retryExplicit = false): NextStep {
  const state = context.state;
  const missing = missingStayStep(state);
  if (missing && missing.kind === "ASK" && missing.field !== "guests") return missing;
  if (!currentAvailability(context)) {
    return planAvailability(context, false);
  }
  if (state.availability.rooms.length === 0) {
    return { kind: "RESPOND", responseIntent: "no_availability", groundedReferences: observedAvailabilityReference(state) };
  }
  if (state.groundedSelection.status !== "grounded" || state.groundedSelection.roomIds.length === 0) {
    return askSelection(state, "quote_requires_grounded_selection");
  }
  if (state.groundedSelection.roomIds.length !== 1) {
    return { kind: "DEGRADE", reasonCode: "QUOTE_MULTI_SELECTION_UNSUPPORTED", recoverable: false, responseIntent: "unsupported_capability" };
  }
  const projection = quoteProjection(state)!;
  const expected = expectedFingerprint(context, "quote", projection);
  if (!expected) {
    return { kind: "DEGRADE", reasonCode: "CAPABILITY_UNAVAILABLE_QUOTE", recoverable: false, responseIntent: "unsupported_capability" };
  }
  if (matchingPending(state, "quote", expected)) {
    return { kind: "WAIT", reason: "tool_pending", ...(state.pendingToolInvocation ? { correlationId: state.pendingToolInvocation.invocationId } : {}) };
  }
  if (state.pendingToolInvocation?.status === "pending") {
    return { kind: "WAIT", reason: "tool_pending", correlationId: state.pendingToolInvocation.invocationId };
  }
  if (state.quote.status === "observed" && state.quote.dependencyFingerprint === expected && state.quote.observationRevision !== undefined) {
    return {
      kind: "RESPOND",
      responseIntent: "quote_result",
      groundedReferences: [{ kind: "quote", observationRevision: state.quote.observationRevision, roomIds: state.quote.roomIds }],
    };
  }
  if (state.quote.status === "failed" && state.quote.dependencyFingerprint === expected && !retryExplicit) {
    return { kind: "DEGRADE", reasonCode: "QUOTE_FAILED", recoverable: true, responseIntent: "quote_failed" };
  }
  const groundedInput = {
    roomId: projection.roomId,
    checkIn: projection.checkIn,
    checkOut: projection.checkOut,
  };
  return callTool(context, "quote", groundedInput, projection, retryExplicit ? "retry_quote" : "get_quote");
}

function reservationProjection(
  state: Readonly<TaskStateV1>,
  capabilityId: "reserve_single" | "reserve_multi",
): Readonly<Record<string, unknown>> | undefined {
  return hotelCapabilityDependencyProjection(state, capabilityId);
}

function planReservation(context: PlanningContext): NextStep {
  const state = context.state;
  const missing = missingStayStep(state);
  if (missing) return missing;
  if (!currentAvailability(context)) {
    return planAvailability(context, false);
  }
  if (state.availability.rooms.length === 0) {
    return { kind: "RESPOND", responseIntent: "no_availability", groundedReferences: observedAvailabilityReference(state) };
  }
  if (state.groundedSelection.status !== "grounded" || state.groundedSelection.roomIds.length === 0) {
    return askSelection(state, "reservation_requires_grounded_selection");
  }
  const requestedRoomCount = state.requestedRoomCount?.value;
  if (requestedRoomCount !== undefined && requestedRoomCount !== state.groundedSelection.roomIds.length) {
    return askSelection(state, "requested_room_count_mismatch");
  }
  if (state.operationIntent?.status !== "active" || state.operationIntent.kind !== "reserve") {
    return {
      kind: "RESPOND",
      responseIntent: "selection_acknowledged",
      groundedReferences: [{ kind: "selection", roomIds: state.groundedSelection.roomIds }],
    };
  }
  if (state.groundedSelection.roomIds.length === 1) {
    const roomId = state.groundedSelection.roomIds[0]!;
    const projection = reservationProjection(state, "reserve_single")!;
    return callTool(
      context,
      "reserve_single",
      { roomId, checkIn: projection.checkIn, checkOut: projection.checkOut },
      projection,
      "reserve",
    );
  }
  const projection = reservationProjection(state, "reserve_multi")!;
  return callTool(
    context,
    "reserve_multi",
    { roomIds: state.groundedSelection.roomIds, checkIn: projection.checkIn, checkOut: projection.checkOut },
    projection,
    "reserve_multi",
  );
}

function planRetry(context: PlanningContext): NextStep {
  const requested = context.trigger.retryDirective?.targetCapabilityId;
  if (requested === "availability") return planAvailability(context, true);
  if (requested === "quote") return planQuote(context, true);
  if (requested) {
    return { kind: "DEGRADE", reasonCode: "WRITE_RETRY_NOT_PLANNER_OWNED", recoverable: true, responseIntent: "retry_requires_control_plane" };
  }
  const failed: HotelCapabilityId[] = [];
  if (context.state.availability.status === "failed") failed.push("availability");
  if (context.state.quote.status === "failed") failed.push("quote");
  if (context.state.execution.status === "failed") failed.push("reserve_single");
  if (failed.length === 0) {
    return { kind: "DEGRADE", reasonCode: "NO_RETRYABLE_OPERATION", recoverable: true, responseIntent: "nothing_to_retry" };
  }
  if (failed.length > 1) {
    return { kind: "ASK", field: "retry_target", reason: "retry_target_ambiguous", dialogueAnchorSpec: { kind: "other_bounded" } };
  }
  const only = failed[0]!;
  if (only === "availability") return planAvailability(context, true);
  if (only === "quote") return planQuote(context, true);
  return { kind: "DEGRADE", reasonCode: "WRITE_RETRY_NOT_PLANNER_OWNED", recoverable: true, responseIntent: "retry_requires_control_plane" };
}

export class HotelTaskPlanner implements DeterministicPlanner {
  plan(context: PlanningContext): NextStep {
    const state = context.state;

    if (state.taskType !== "hotel_reservation_domain" || context.taskDefinition.id !== "hotel_task_v1") {
      return { kind: "DEGRADE", reasonCode: "TASK_DEFINITION_MISMATCH", recoverable: false, responseIntent: "technical_contract_error" };
    }

    if (state.execution.status === "confirmed") {
      const booking = state.bookings.at(-1);
      return {
        kind: "COMPLETE",
        completionReason: state.execution.outcomeKind ?? "operation_confirmed",
        responseIntent: state.execution.outcomeKind ?? "operation_confirmed",
        groundedReferences: [
          ...(state.execution.operationId ? [{ kind: "operation", operationId: state.execution.operationId } as const] : []),
          ...(booking ? [{ kind: "booking", bookingId: booking.bookingId } as const] : []),
        ],
      };
    }

    if (state.lifecycle !== "active") {
      return {
        kind: "COMPLETE",
        completionReason: `task_${state.lifecycle}`,
        responseIntent: `task_${state.lifecycle}`,
        groundedReferences: [],
      };
    }

    if (state.execution.status === "executing") {
      return { kind: "WAIT", reason: "external_event", ...(state.execution.operationId ? { correlationId: state.execution.operationId } : {}) };
    }

    if (context.trigger.abortDirective) {
      return { kind: "RESPOND", responseIntent: "operation_aborted", groundedReferences: [] };
    }

    if (context.trigger.retryDirective) {
      return planRetry(context);
    }

    if (context.trigger.readDirective?.kind === "knowledge") {
      return { kind: "DEGRADE", reasonCode: "KNOWLEDGE_CAPABILITY_UNAVAILABLE", recoverable: false, responseIntent: "knowledge_unavailable" };
    }
    if (context.trigger.readDirective?.kind === "quote") {
      return planQuote(context, false);
    }
    if (context.trigger.readDirective?.kind === "availability") {
      return planAvailability(context, false);
    }
    if (context.trigger.showOptionsDirective) {
      if (currentAvailability(context) && state.availability.rooms.length > 0) {
        return askSelection(state, "show_options_requested");
      }
      return planAvailability(context, false);
    }

    if (state.preparedOperation?.status === "approval_required") {
      return { kind: "WAIT", reason: "approval_pending", correlationId: state.preparedOperation.operationId };
    }
    if (state.preparedOperation?.status === "approved" || state.preparedOperation?.status === "prepared") {
      return { kind: "WAIT", reason: "external_event", correlationId: state.preparedOperation.operationId };
    }

    if (state.execution.status === "failed") {
      return { kind: "DEGRADE", reasonCode: state.execution.failureCode ?? "OPERATION_EXECUTION_FAILED", recoverable: true, responseIntent: "operation_failed" };
    }

    if (state.operationIntent?.status === "ambiguous") {
      return { kind: "ASK", field: "selection", reason: "operation_target_ambiguous", dialogueAnchorSpec: { kind: "other_bounded" } };
    }

    const goal = state.requestedGoal?.value;
    if (state.operationIntent?.status === "active" && state.operationIntent.kind === "reserve") {
      return planReservation(context);
    }
    if (state.operationIntent?.status === "active" && (state.operationIntent.kind === "cancel" || state.operationIntent.kind === "modify")) {
      return {
        kind: "DEGRADE",
        reasonCode: "BOOKING_TARGET_GROUNDING_REQUIRED",
        recoverable: true,
        responseIntent: "booking_target_not_grounded",
      };
    }
    if (goal === "reservation") return planReservation(context);
    if (goal === "availability") return planAvailability(context, false);
    if (goal === "quote") return planQuote(context, false);
    if (goal === "cancellation" || goal === "modification") {
      return {
        kind: "DEGRADE",
        reasonCode: "BOOKING_TARGET_GROUNDING_REQUIRED",
        recoverable: true,
        responseIntent: "booking_target_not_grounded",
      };
    }

    if (context.trigger.interactionDirective) {
      return { kind: "RESPOND", responseIntent: context.trigger.interactionDirective, groundedReferences: [] };
    }

    return { kind: "DEGRADE", reasonCode: "NO_SAFE_NEXT_ACTION", recoverable: true, responseIntent: "need_task_intent" };
  }
}
