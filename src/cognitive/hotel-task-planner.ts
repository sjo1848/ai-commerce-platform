import type { DialogueAnchor, NextStep, PlanningTrigger, TaskState } from "./contracts.js";
import { dependencyFingerprint } from "./fingerprint.js";
import type { DependencyValue } from "./fingerprint.js";
import type {
  DomainCapabilities,
  HotelCapabilityBinding,
  HotelCapabilityKey,
  HotelTaskDefinition,
} from "./hotel-task-definition.js";
import { HOTEL_TASK_DEFINITION_V1 } from "./hotel-task-definition.js";

export type HotelPlanningContext = {
  state: Readonly<TaskState>;
  trigger: Readonly<PlanningTrigger>;
  taskDefinition?: HotelTaskDefinition;
  capabilities: DomainCapabilities;
};

type AnchorSpec = Omit<DialogueAnchor, "anchorId" | "createdAtStateRevision">;
type DependencyProjection = { readonly [key: string]: DependencyValue | undefined };

type CapabilityResolution =
  | { ok: true; binding: HotelCapabilityBinding }
  | { ok: false; reason: "unavailable" | "contract_mismatch" };

function degrade(reasonCode: string, recoverable: boolean, responseIntent = "technical_degradation"): NextStep {
  return { kind: "DEGRADE", reasonCode, recoverable, responseIntent };
}

function respond(responseIntent: string, groundedReferences: readonly string[] = []): NextStep {
  return { kind: "RESPOND", responseIntent, groundedReferences };
}

function ask(
  field: string,
  reason: string,
  anchor: AnchorSpec,
  presentationContext?: Readonly<Record<string, unknown>>,
): NextStep {
  return {
    kind: "ASK",
    field,
    reason,
    ...(presentationContext !== undefined ? { presentationContext } : {}),
    dialogueAnchorSpec: anchor,
  };
}

function resolveCapability(
  context: HotelPlanningContext,
  key: HotelCapabilityKey,
): CapabilityResolution {
  const expected = (context.taskDefinition ?? HOTEL_TASK_DEFINITION_V1).bindings[key];
  const actual = context.capabilities.enabled[key];
  if (!actual) return { ok: false, reason: "unavailable" };
  if (
    actual.key !== expected.key ||
    actual.capabilityId !== expected.capabilityId ||
    actual.contractIdentity !== expected.contractIdentity ||
    actual.effectClass !== expected.effectClass ||
    JSON.stringify(actual.dependencyPaths) !== JSON.stringify(expected.dependencyPaths)
  ) {
    return { ok: false, reason: "contract_mismatch" };
  }
  return { ok: true, binding: actual };
}

function contextContractValid(context: HotelPlanningContext): boolean {
  const definition = context.taskDefinition ?? HOTEL_TASK_DEFINITION_V1;
  return (
    definition.id === "hotel_task_v1" &&
    definition.contractIdentity === "hotel_task_v1@1" &&
    context.capabilities.domain === "hotel" &&
    context.capabilities.definitionId === definition.id &&
    context.capabilities.definitionContractIdentity === definition.contractIdentity
  );
}

function availabilityMatchesRequestedStay(state: Readonly<TaskState>): boolean {
  const availability = state.observations.availability;
  if (!availability) return true;
  return (
    state.user.stay.checkIn === availability.query.checkIn &&
    state.user.stay.checkOut === availability.query.checkOut &&
    state.user.stay.guests === availability.query.guests
  );
}

function activePending(state: Readonly<TaskState>) {
  const pending = state.control.pendingToolInvocation;
  return pending && (pending.status === "admitted" || pending.status === "dispatched") ? pending : undefined;
}

async function callCapability(
  context: HotelPlanningContext,
  key: HotelCapabilityKey,
  groundedInput: Readonly<Record<string, unknown>>,
  dependencyProjection: DependencyProjection,
  correlationIntent: string,
): Promise<NextStep> {
  const resolved = resolveCapability(context, key);
  if (!resolved.ok) {
    return degrade(
      resolved.reason === "contract_mismatch" ? "capability_contract_mismatch" : `capability_unavailable:${key}`,
      resolved.reason === "unavailable",
      resolved.reason === "unavailable" ? "capability_unavailable" : "technical_degradation",
    );
  }

  const preconditionFingerprint = await dependencyFingerprint({
    plannerContract: "hotel_task_planner_v1@1",
    taskDefinition: (context.taskDefinition ?? HOTEL_TASK_DEFINITION_V1).contractIdentity,
    capabilityContract: resolved.binding.contractIdentity,
    capabilityId: resolved.binding.capabilityId,
    dependencyProjection,
  });

  const pending = activePending(context.state);
  if (
    pending &&
    pending.capabilityId === resolved.binding.capabilityId &&
    pending.dependencyFingerprint === preconditionFingerprint
  ) {
    return {
      kind: "WAIT",
      reason: "tool_pending",
      correlationId: pending.invocationId,
    };
  }
  if (pending) {
    return degrade("parallel_tool_invocation_not_supported_v1", true, "tool_pending_conflict");
  }

  return {
    kind: "CALL_TOOL",
    capabilityId: resolved.binding.capabilityId,
    groundedInput,
    preconditionFingerprint,
    correlationIntent,
    effectClass: resolved.binding.effectClass,
  };
}

function stayMissingStep(state: Readonly<TaskState>, includeGuests: boolean): NextStep | undefined {
  if (!state.user.stay.checkIn) {
    return ask("checkIn", "missing_check_in", { kind: "dates", dependencyPaths: ["user.stay.checkIn"] });
  }
  if (!state.user.stay.checkOut) {
    return ask("checkOut", "missing_check_out", { kind: "check_out", dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut"] });
  }
  if (includeGuests && state.user.stay.guests === undefined) {
    return ask("guests", "missing_guests", { kind: "guests", dependencyPaths: ["user.stay.guests"] });
  }
  return undefined;
}

function availabilityInput(state: Readonly<TaskState>): { checkIn: string; checkOut: string; guests: number } | undefined {
  const { checkIn, checkOut, guests } = state.user.stay;
  return checkIn && checkOut && guests !== undefined ? { checkIn, checkOut, guests } : undefined;
}

async function availabilityStep(context: HotelPlanningContext): Promise<NextStep> {
  const missing = stayMissingStep(context.state, true);
  if (missing) return missing;

  const current = context.state.observations.availability;
  if (current) {
    if (current.rooms.length === 0) return respond("no_availability", [current.observationId]);
    return respond("availability_results", [current.observationId]);
  }

  const input = availabilityInput(context.state);
  if (!input) return degrade("planner_state_invariant", false);
  return callCapability(context, "availability", input, {
    lifecycle: context.state.lifecycle,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
  }, "acquire_availability");
}

function selectionAsk(state: Readonly<TaskState>): NextStep {
  const availability = state.observations.availability;
  if (!availability) return degrade("selection_without_availability", true, "availability_required");
  return ask(
    "selection",
    state.user.requestedSelectionReference ? "selection_reference_not_grounded" : "room_selection_required",
    {
      kind: "selection",
      dependencyFingerprint: availability.dependencyFingerprint,
      dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
      referencedObservationId: availability.observationId,
      candidateScope: availability.rooms.map((room) => room.roomId),
    },
    {
      observationId: availability.observationId,
      rooms: availability.rooms,
    },
  );
}

async function quoteStep(context: HotelPlanningContext): Promise<NextStep> {
  const missing = stayMissingStep(context.state, false);
  if (missing) return missing;

  const selection = context.state.control.groundedSelection;
  if (!selection) {
    const availability = context.state.observations.availability;
    if (!availability) {
      const withGuests = stayMissingStep(context.state, true);
      if (withGuests) return withGuests;
      const input = availabilityInput(context.state);
      if (!input) return degrade("planner_state_invariant", false);
      return callCapability(context, "availability", input, {
        lifecycle: context.state.lifecycle,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        guests: input.guests,
      }, "acquire_availability_for_quote");
    }
    if (availability.rooms.length === 0) return respond("no_availability", [availability.observationId]);
    return selectionAsk(context.state);
  }
  if (selection.roomIds.length !== 1) return degrade("quote_requires_single_room", true, "single_room_required");

  const roomId = selection.roomIds[0];
  if (!roomId) return degrade("planner_state_invariant", false);
  const existing = context.state.observations.quote;
  if (existing?.roomId === roomId) return respond("quote_result", [existing.observationId]);

  const { checkIn, checkOut } = context.state.user.stay;
  if (!checkIn || !checkOut) return degrade("planner_state_invariant", false);
  return callCapability(context, "quote", { roomId, checkIn, checkOut }, {
    lifecycle: context.state.lifecycle,
    roomId,
    checkIn,
    checkOut,
    groundedSelectionFingerprint: selection.dependencyFingerprint,
  }, "acquire_quote");
}

function latestExecutionSucceeded(state: Readonly<TaskState>, operationType: "reserve" | "cancel" | "modify") {
  for (let index = state.observations.executionResults.length - 1; index >= 0; index -= 1) {
    const result = state.observations.executionResults[index];
    if (result?.operationType === operationType && result.status === "succeeded") return result;
  }
  return undefined;
}

async function reservationStep(context: HotelPlanningContext): Promise<NextStep> {
  const success = latestExecutionSucceeded(context.state, "reserve");
  if (success && context.state.observations.booking) {
    return {
      kind: "COMPLETE",
      completionReason: "reservation_confirmed",
      responseIntent: "reservation_confirmed",
      groundedReferences: [context.state.observations.booking.observationId, context.state.observations.booking.bookingId],
    };
  }

  const missing = stayMissingStep(context.state, true);
  if (missing) return missing;

  const availability = context.state.observations.availability;
  if (!availability) {
    const input = availabilityInput(context.state);
    if (!input) return degrade("planner_state_invariant", false);
    return callCapability(context, "availability", input, {
      lifecycle: context.state.lifecycle,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guests: input.guests,
    }, "acquire_availability_for_reservation");
  }
  if (availability.rooms.length === 0) return respond("no_availability", [availability.observationId]);

  const selection = context.state.control.groundedSelection;
  if (!selection) return selectionAsk(context.state);

  const expectedCount = context.state.user.requestedRoomCount;
  if (expectedCount !== undefined && selection.roomIds.length !== expectedCount) {
    return selectionAsk(context.state);
  }

  if (context.state.user.operationIntent !== "reserve") {
    return respond("reservation_ready_for_commit", [selection.sourceObservationId]);
  }

  const prepared = context.state.control.preparedOperation;
  if (prepared?.operationType === "reserve") {
    if (prepared.status === "approval_required") return { kind: "WAIT", reason: "approval_pending", correlationId: prepared.operationId };
    if (prepared.status === "approved") return { kind: "WAIT", reason: "external_event", correlationId: prepared.operationId };
    if (prepared.status === "prepared") return { kind: "WAIT", reason: "external_event", correlationId: prepared.operationId };
  }

  const { checkIn, checkOut } = context.state.user.stay;
  if (!checkIn || !checkOut) return degrade("planner_state_invariant", false);
  if (selection.roomIds.length === 1) {
    const roomId = selection.roomIds[0];
    if (!roomId) return degrade("planner_state_invariant", false);
    return callCapability(context, "reserve_single", { roomId, checkIn, checkOut }, {
      lifecycle: context.state.lifecycle,
      operationIntent: "reserve",
      checkIn,
      checkOut,
      roomIds: [roomId],
      groundedSelectionFingerprint: selection.dependencyFingerprint,
    }, "propose_single_reservation");
  }

  if (selection.roomIds.length > 1) {
    return callCapability(context, "reserve_multi", { roomIds: selection.roomIds, checkIn, checkOut }, {
      lifecycle: context.state.lifecycle,
      operationIntent: "reserve",
      checkIn,
      checkOut,
      roomIds: selection.roomIds,
      groundedSelectionFingerprint: selection.dependencyFingerprint,
    }, "propose_multi_reservation");
  }

  return degrade("empty_grounded_selection", false);
}

async function cancellationStep(context: HotelPlanningContext): Promise<NextStep> {
  const success = latestExecutionSucceeded(context.state, "cancel");
  if (success && context.state.observations.booking) {
    return {
      kind: "COMPLETE",
      completionReason: "reservation_cancelled",
      responseIntent: "reservation_cancelled",
      groundedReferences: [context.state.observations.booking.observationId, context.state.observations.booking.bookingId],
    };
  }

  if (!context.state.user.bookingReference && !context.state.control.groundedBookingTarget) {
    return ask("bookingReference", "booking_reference_required", { kind: "booking_reference", dependencyPaths: ["user.bookingReference"] });
  }
  const target = context.state.control.groundedBookingTarget;
  if (!target) return degrade("booking_lookup_unavailable", true, "booking_target_not_grounded");
  if (context.state.user.operationIntent !== "cancel") return respond("cancellation_ready_for_commit", [target.sourceObservationId]);

  const prepared = context.state.control.preparedOperation;
  if (prepared?.operationType === "cancel") {
    if (prepared.status === "approval_required") return { kind: "WAIT", reason: "approval_pending", correlationId: prepared.operationId };
    if (prepared.status === "approved" || prepared.status === "prepared") return { kind: "WAIT", reason: "external_event", correlationId: prepared.operationId };
  }

  return callCapability(context, "cancel_single", { bookingId: target.bookingId }, {
    lifecycle: context.state.lifecycle,
    operationIntent: "cancel",
    bookingId: target.bookingId,
    groundedBookingFingerprint: target.dependencyFingerprint,
  }, "propose_single_cancellation");
}

function retryTarget(context: HotelPlanningContext): string | undefined | null {
  const explicit = context.trigger.retryDirective?.targetOperation?.trim();
  if (explicit) return explicit;
  const ids = [...new Set(context.state.observations.failures.map((failure) => failure.capabilityId))];
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) return null;
  return undefined;
}

async function retryStep(context: HotelPlanningContext): Promise<NextStep> {
  const target = retryTarget(context);
  if (target === null) {
    return ask("retryTarget", "retry_target_ambiguous", { kind: "other_bounded", dependencyPaths: ["control.pendingToolInvocation"] });
  }
  if (!target) return degrade("retry_target_missing", true, "retry_target_required");

  if (target === "availability" || target === "hms.checkAvailability") {
    const missing = stayMissingStep(context.state, true);
    if (missing) return missing;
    if (context.state.observations.availability) return respond("availability_results", [context.state.observations.availability.observationId]);
    const input = availabilityInput(context.state);
    if (!input) return degrade("planner_state_invariant", false);
    return callCapability(context, "availability", input, {
      lifecycle: context.state.lifecycle,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guests: input.guests,
    }, "retry_availability");
  }

  if (target === "quote" || target === "hms.getQuote") return quoteStep(context);

  if (
    target === "reserve" ||
    target === "cancel" ||
    target === "hms.createReservation" ||
    target === "hms.createMultiReservation" ||
    target === "hms.cancelReservation" ||
    target === "hms.cancelMultiReservation"
  ) {
    return degrade("write_retry_requires_core_recovery", false, "write_recovery_required");
  }
  return degrade("retry_target_unsupported", true, "retry_target_unsupported");
}

async function explicitReadStep(context: HotelPlanningContext): Promise<NextStep> {
  const read = context.trigger.readDirective;
  if (!read) return degrade("planner_state_invariant", false);
  switch (read.kind) {
    case "availability":
      return availabilityStep(context);
    case "quote":
      return quoteStep(context);
    case "show_options": {
      const availability = context.state.observations.availability;
      if (!availability) return availabilityStep(context);
      if (availability.rooms.length === 0) return respond("no_availability", [availability.observationId]);
      return context.state.user.requestedGoal === "reservation"
        ? selectionAsk(context.state)
        : respond("availability_results", [availability.observationId]);
    }
    case "compare":
      return degrade("comparison_capability_unavailable", true, "comparison_unavailable");
    default:
      return degrade(`read_capability_unavailable:${read.kind}`, true, "read_capability_unavailable");
  }
}

/**
 * Deterministic hotel-domain planner. It consumes only post-reducer,
 * post-grounding TaskState plus a normalized trigger and semantic capability
 * view. It does not interpret language, authorize, execute or render prose.
 */
export async function planHotelTask(context: HotelPlanningContext): Promise<NextStep> {
  if (!contextContractValid(context)) return degrade("planner_contract_mismatch", false);

  if (context.state.lifecycle === "completed") {
    return {
      kind: "COMPLETE",
      completionReason: "task_already_completed",
      responseIntent: "task_completed",
      groundedReferences: [],
    };
  }
  if (context.state.lifecycle !== "active") return respond("task_inactive");

  if (!availabilityMatchesRequestedStay(context.state)) {
    return degrade("availability_dependency_mismatch", false, "state_invariant_violation");
  }

  if (context.trigger.abortDirective) return respond("current_operation_aborted");
  if (context.trigger.interactionDirective) return respond(`interaction_${context.trigger.interactionDirective}`);
  if (context.trigger.retryDirective) return retryStep(context);
  if (context.trigger.readDirective) return explicitReadStep(context);
  if (context.trigger.showOptionsDirective) {
    const availability = context.state.observations.availability;
    if (!availability) return availabilityStep(context);
    if (availability.rooms.length === 0) return respond("no_availability", [availability.observationId]);
    return context.state.user.requestedGoal === "reservation"
      ? selectionAsk(context.state)
      : respond("availability_results", [availability.observationId]);
  }

  if (context.state.user.ambiguity) {
    return ask(
      context.state.user.ambiguity.field ?? "clarification",
      `ambiguity:${context.state.user.ambiguity.code}`,
      { kind: "other_bounded", dependencyPaths: ["user.ambiguity"] },
    );
  }

  if (context.state.user.operationIntent && !context.state.user.requestedGoal) {
    return degrade("commit_without_goal", false, "semantic_state_invalid");
  }

  switch (context.state.user.requestedGoal) {
    case "availability":
      return availabilityStep(context);
    case "quote":
      return quoteStep(context);
    case "reservation":
      return reservationStep(context);
    case "cancellation":
      return cancellationStep(context);
    case "modification":
      return degrade("modification_capability_unavailable", true, "modification_unavailable");
    default: {
      const pending = activePending(context.state);
      if (pending) return { kind: "WAIT", reason: "tool_pending", correlationId: pending.invocationId };
      return respond("goal_required");
    }
  }
}
