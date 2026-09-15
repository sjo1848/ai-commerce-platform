import type {
  DependencyBound,
  DependencyPath,
  PendingToolInvocation,
  PreparedOperation,
  TaskState,
  UserRequestedSemantics,
} from "./contracts.js";
import type {
  ServerControlEvent,
  TaskEvent,
  TaskStateInvalidation,
  TaskStateReduction,
  TaskStateRejection,
  ToolAuthorityRef,
  ToolObservationEvent,
  UserSemanticEvent,
  UserSemanticPatch,
} from "./events.js";

const RECENT_EVENT_WINDOW = 64;
const TOOL_FAILURE_WINDOW = 16;
const MAX_GUESTS = 20;
const MAX_ROOM_COUNT = 10;
const MAX_PREFERENCES = 32;

function cloneState(state: Readonly<TaskState>): TaskState {
  return JSON.parse(JSON.stringify(state)) as TaskState;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasDependency(bound: DependencyBound | { dependencyPaths: readonly DependencyPath[] }, changed: ReadonlySet<DependencyPath>): boolean {
  return bound.dependencyPaths.some((path) => changed.has(path));
}

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function validStay(stay: Readonly<UserRequestedSemantics["stay"]>): boolean {
  if (stay.checkIn !== undefined && !validIsoDate(stay.checkIn)) return false;
  if (stay.checkOut !== undefined && !validIsoDate(stay.checkOut)) return false;
  if (stay.checkIn !== undefined && stay.checkOut !== undefined && stay.checkIn >= stay.checkOut) return false;
  if (stay.guests !== undefined && (!Number.isInteger(stay.guests) || stay.guests < 1 || stay.guests > MAX_GUESTS)) return false;
  return true;
}

function validReference(reference: unknown): boolean {
  if (!reference || typeof reference !== "object") return false;
  const ref = reference as { kind?: string; value?: unknown; values?: unknown; role?: unknown };
  if (ref.kind === "room_number") return typeof ref.value === "string" && ref.value.trim().length > 0;
  if (ref.kind === "ordinal") return Number.isInteger(ref.value) && Number(ref.value) > 0;
  if (ref.kind === "ordinal_set") {
    return Array.isArray(ref.values) && ref.values.length > 0 && ref.values.every((value) => Number.isInteger(value) && Number(value) > 0);
  }
  if (ref.kind === "relation") return ref.value === "other" || ref.value === "both";
  if (ref.kind === "contextual_anchor") {
    return ref.role === "focused_entity" || ref.role === "current_selection" || ref.role === "presented_set";
  }
  if (ref.kind === "visible_reference") return typeof ref.value === "string" && ref.value.trim().length > 0;
  return false;
}

function validOccupancy(value: UserRequestedSemantics["requestedOccupancy"], semantics: Readonly<UserRequestedSemantics>): boolean {
  if (!value) return true;
  let total = 0;
  let rooms = 0;
  if (value.kind === "ordered_distribution") {
    if (value.guestsPerRoom.length === 0 || value.guestsPerRoom.some((guests) => !Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS)) return false;
    total = value.guestsPerRoom.reduce((sum, guests) => sum + guests, 0);
    rooms = value.guestsPerRoom.length;
  } else {
    if (value.assignments.length === 0 || value.assignments.some((assignment) => !validReference(assignment.room) || !Number.isInteger(assignment.guests) || assignment.guests < 1 || assignment.guests > MAX_GUESTS)) return false;
    total = value.assignments.reduce((sum, assignment) => sum + assignment.guests, 0);
    rooms = value.assignments.length;
  }
  if (semantics.stay.guests !== undefined && total !== semantics.stay.guests) return false;
  if (semantics.requestedRoomCount !== undefined && rooms !== semantics.requestedRoomCount) return false;
  return true;
}

function validUserSemantics(semantics: Readonly<UserRequestedSemantics>): boolean {
  if (!validStay(semantics.stay)) return false;
  if (semantics.preferences.length > MAX_PREFERENCES) return false;
  if (semantics.preferences.some((value) => typeof value !== "string" || value.trim().length === 0 || value.length > 200)) return false;
  if (semantics.requestedSelectionReference !== undefined && !validReference(semantics.requestedSelectionReference)) return false;
  if (semantics.bookingReference !== undefined && !validReference(semantics.bookingReference)) return false;
  if (semantics.requestedRoomCount !== undefined && (!Number.isInteger(semantics.requestedRoomCount) || semantics.requestedRoomCount < 1 || semantics.requestedRoomCount > MAX_ROOM_COUNT)) return false;
  if (semantics.ambiguity !== undefined && (semantics.ambiguity.code.trim().length === 0 || semantics.ambiguity.code.length > 100)) return false;
  return validOccupancy(semantics.requestedOccupancy, semantics);
}

function applyOptionalPatch<T>(
  object: Record<string, unknown>,
  key: string,
  patch: { op: "set"; value: T } | { op: "clear" } | undefined,
  path: DependencyPath,
  changed: Set<DependencyPath>,
): void {
  if (!patch) return;
  if (patch.op === "clear") {
    if (object[key] !== undefined) {
      delete object[key];
      changed.add(path);
    }
    return;
  }
  if (!sameValue(object[key], patch.value)) {
    object[key] = patch.value;
    changed.add(path);
  }
}

function applyUserPatch(state: TaskState, patch: UserSemanticPatch): Set<DependencyPath> | null {
  const prospective = cloneState(state).user;
  const changed = new Set<DependencyPath>();

  applyOptionalPatch(prospective as unknown as Record<string, unknown>, "requestedGoal", patch.requestedGoal, "user.requestedGoal", changed);
  if (patch.stay) {
    applyOptionalPatch(prospective.stay as Record<string, unknown>, "checkIn", patch.stay.checkIn, "user.stay.checkIn", changed);
    applyOptionalPatch(prospective.stay as Record<string, unknown>, "checkOut", patch.stay.checkOut, "user.stay.checkOut", changed);
    applyOptionalPatch(prospective.stay as Record<string, unknown>, "guests", patch.stay.guests, "user.stay.guests", changed);
  }
  applyOptionalPatch(prospective as unknown as Record<string, unknown>, "preferences", patch.preferences, "user.preferences", changed);
  applyOptionalPatch(prospective as unknown as Record<string, unknown>, "requestedSelectionReference", patch.requestedSelectionReference, "user.requestedSelectionReference", changed);
  applyOptionalPatch(prospective as unknown as Record<string, unknown>, "requestedRoomCount", patch.requestedRoomCount, "user.requestedRoomCount", changed);
  applyOptionalPatch(prospective as unknown as Record<string, unknown>, "requestedOccupancy", patch.requestedOccupancy, "user.requestedOccupancy", changed);
  applyOptionalPatch(prospective as unknown as Record<string, unknown>, "operationIntent", patch.operationIntent, "user.operationIntent", changed);
  applyOptionalPatch(prospective as unknown as Record<string, unknown>, "bookingReference", patch.bookingReference, "user.bookingReference", changed);
  applyOptionalPatch(prospective as unknown as Record<string, unknown>, "ambiguity", patch.ambiguity, "user.ambiguity", changed);

  if (!validUserSemantics(prospective)) return null;
  state.user = prospective;
  return changed;
}

function invalidation(target: TaskStateInvalidation["target"], causedBy: ReadonlySet<DependencyPath>): TaskStateInvalidation {
  return { target, reason: "dependency_changed", causedBy: [...causedBy].sort() };
}

function applyCausalInvalidation(state: TaskState, initialChanged: ReadonlySet<DependencyPath>): TaskStateInvalidation[] {
  const changed = new Set<DependencyPath>(initialChanged);
  const result: TaskStateInvalidation[] = [];
  let progress = true;

  while (progress) {
    progress = false;

    const availability = state.observations.availability;
    if (availability && hasDependency(availability, changed)) {
      delete state.observations.availability;
      result.push(invalidation("observations.availability", changed));
      changed.add("observations.availability");
      progress = true;
    }

    const quote = state.observations.quote;
    if (quote && hasDependency(quote, changed)) {
      delete state.observations.quote;
      result.push(invalidation("observations.quote", changed));
      changed.add("observations.quote");
      progress = true;
    }

    const booking = state.observations.booking;
    if (booking && hasDependency(booking, changed)) {
      delete state.observations.booking;
      result.push(invalidation("observations.booking", changed));
      changed.add("observations.booking");
      progress = true;
    }

    const groundedSelection = state.control.groundedSelection;
    if (groundedSelection && hasDependency(groundedSelection, changed)) {
      delete state.control.groundedSelection;
      result.push(invalidation("control.groundedSelection", changed));
      changed.add("control.groundedSelection");
      progress = true;
    }

    const groundedBooking = state.control.groundedBookingTarget;
    if (groundedBooking && hasDependency(groundedBooking, changed)) {
      delete state.control.groundedBookingTarget;
      result.push(invalidation("control.groundedBookingTarget", changed));
      changed.add("control.groundedBookingTarget");
      progress = true;
    }

    const invocation = state.control.pendingToolInvocation;
    if (invocation && (invocation.status === "admitted" || invocation.status === "dispatched") && hasDependency(invocation, changed)) {
      state.control.pendingToolInvocation = { ...invocation, status: "superseded" };
      result.push(invalidation("control.pendingToolInvocation", changed));
      changed.add("control.pendingToolInvocation");
      progress = true;
    }

    const operation = state.control.preparedOperation;
    if (operation && operation.status !== "invalidated" && hasDependency(operation, changed)) {
      state.control.preparedOperation = { ...operation, status: "invalidated" };
      result.push(invalidation("control.preparedOperation", changed));
      changed.add("control.preparedOperation");
      progress = true;
    }

    const anchor = state.control.dialogueAnchor;
    if (anchor && hasDependency(anchor, changed)) {
      delete state.control.dialogueAnchor;
      result.push(invalidation("control.dialogueAnchor", changed));
      changed.add("control.dialogueAnchor");
      progress = true;
    }
  }

  return result;
}

function validDependencyBound(value: DependencyBound): boolean {
  return value.dependencyFingerprint.trim().length > 0 && value.dependencyPaths.length > 0;
}

function validateInvocationAuthority(state: Readonly<TaskState>, authority: Extract<ToolAuthorityRef, { kind: "invocation" }>): boolean {
  const invocation = state.control.pendingToolInvocation;
  return Boolean(
    invocation &&
    invocation.invocationId === authority.invocationId &&
    invocation.dependencyFingerprint === authority.dependencyFingerprint &&
    (invocation.status === "admitted" || invocation.status === "dispatched"),
  );
}

function validateOperationAuthority(state: Readonly<TaskState>, authority: Extract<ToolAuthorityRef, { kind: "operation" }>): boolean {
  const operation = state.control.preparedOperation;
  return Boolean(
    operation &&
    operation.operationId === authority.operationId &&
    operation.operationFingerprint === authority.operationFingerprint &&
    operation.dependencyFingerprint === authority.dependencyFingerprint &&
    operation.status !== "invalidated" &&
    operation.status !== "approval_required",
  );
}

function validateToolAuthority(state: Readonly<TaskState>, authority: ToolAuthorityRef): boolean {
  return authority.kind === "invocation"
    ? validateInvocationAuthority(state, authority)
    : validateOperationAuthority(state, authority);
}

function validateAvailabilityObservation(event: ToolObservationEvent & { payload: Extract<ToolObservationEvent["payload"], { kind: "availability" }> }): boolean {
  const observation = event.payload.observation;
  if (!validDependencyBound(observation) || observation.source !== "tool" || observation.status !== "observed") return false;
  if (observation.dependencyFingerprint !== event.payload.authority.dependencyFingerprint) return false;
  if (!validStay(observation.query)) return false;
  const ids = observation.rooms.map((room) => room.roomId);
  return ids.every((id) => id.trim().length > 0) && new Set(ids).size === ids.length;
}

function applyToolEvent(state: TaskState, event: ToolObservationEvent): { invalidations: TaskStateInvalidation[] } | null {
  const payload = event.payload;
  if (!validateToolAuthority(state, payload.authority)) return null;

  const changed = new Set<DependencyPath>();
  if (payload.kind === "availability") {
    if (!validateAvailabilityObservation(event as ToolObservationEvent & { payload: Extract<ToolObservationEvent["payload"], { kind: "availability" }> })) return null;
    state.observations.availability = payload.observation;
    changed.add("observations.availability");
  } else if (payload.kind === "quote") {
    if (!validDependencyBound(payload.observation) || payload.observation.source !== "tool" || payload.observation.totalCents < 0 || !Number.isInteger(payload.observation.totalCents) || payload.observation.currency.trim().length === 0) return null;
    if (payload.observation.dependencyFingerprint !== payload.authority.dependencyFingerprint) return null;
    state.observations.quote = payload.observation;
    changed.add("observations.quote");
  } else if (payload.kind === "booking") {
    if (!validDependencyBound(payload.observation) || payload.observation.source !== "tool" || payload.observation.bookingId.trim().length === 0) return null;
    if (payload.observation.dependencyFingerprint !== payload.authority.dependencyFingerprint) return null;
    state.observations.booking = payload.observation;
    changed.add("observations.booking");
  } else if (payload.kind === "execution_succeeded") {
    state.observations.executionResults = [
      ...state.observations.executionResults,
      {
        operationId: payload.authority.operationId,
        operationType: payload.operationType,
        status: "succeeded",
        ...(payload.observationId ? { observationId: payload.observationId } : {}),
      },
    ].slice(-16);
  } else {
    if (!validDependencyBound(payload.failure) || payload.failure.failureId.trim().length === 0 || payload.failure.dependencyFingerprint !== payload.authority.dependencyFingerprint) return null;
    state.observations.failures = [...state.observations.failures, payload.failure].slice(-TOOL_FAILURE_WINDOW);
  }

  if (payload.authority.kind === "invocation") {
    const current = state.control.pendingToolInvocation;
    if (!current) return null;
    state.control.pendingToolInvocation = {
      ...current,
      status: payload.kind === "failure" ? "failed" : "succeeded",
      terminalCorrelationId: event.eventId,
    };
  }

  return { invalidations: applyCausalInvalidation(state, changed) };
}

function validPreparedOperation(operation: PreparedOperation): boolean {
  return operation.operationId.trim().length > 0 && operation.operationFingerprint.trim().length > 0 && validDependencyBound(operation) && operation.status === "prepared";
}

function validInvocation(invocation: PendingToolInvocation): boolean {
  return invocation.invocationId.trim().length > 0 && invocation.capabilityId.trim().length > 0 && invocation.status === "admitted" && validDependencyBound(invocation) && validTimestamp(invocation.admittedAt) && validTimestamp(invocation.leaseExpiresAt) && Date.parse(invocation.leaseExpiresAt) > Date.parse(invocation.admittedAt);
}

function applyServerEvent(state: TaskState, event: ServerControlEvent): { changed: Set<DependencyPath>; invalidations: TaskStateInvalidation[] } | null {
  const payload = event.payload;
  const changed = new Set<DependencyPath>();

  if (payload.kind === "reference_grounded") {
    const availability = state.observations.availability;
    const grounding = payload.groundedSelection;
    if (!availability || grounding.authority !== "server" || !validDependencyBound(grounding)) return null;
    if (grounding.sourceObservationId !== availability.observationId || !grounding.dependencyPaths.includes("observations.availability")) return null;
    const candidateIds = new Set(availability.rooms.map((room) => room.roomId));
    if (grounding.roomIds.length === 0 || new Set(grounding.roomIds).size !== grounding.roomIds.length || grounding.roomIds.some((roomId) => !candidateIds.has(roomId))) return null;
    if (!sameValue(state.control.groundedSelection, grounding)) {
      state.control.groundedSelection = grounding;
      changed.add("control.groundedSelection");
    }
  } else if (payload.kind === "booking_reference_grounded") {
    const booking = state.observations.booking;
    const grounding = payload.groundedBookingTarget;
    if (!booking || grounding.authority !== "server" || !validDependencyBound(grounding)) return null;
    if (grounding.sourceObservationId !== booking.observationId || grounding.bookingId !== booking.bookingId || !grounding.dependencyPaths.includes("observations.booking")) return null;
    if (!sameValue(state.control.groundedBookingTarget, grounding)) {
      state.control.groundedBookingTarget = grounding;
      changed.add("control.groundedBookingTarget");
    }
  } else if (payload.kind === "invocation_recorded") {
    if (!validInvocation(payload.invocation)) return null;
    const current = state.control.pendingToolInvocation;
    if (current && (current.status === "admitted" || current.status === "dispatched") && current.invocationId !== payload.invocation.invocationId) return null;
    state.control.pendingToolInvocation = payload.invocation;
  } else if (payload.kind === "invocation_dispatched") {
    const current = state.control.pendingToolInvocation;
    if (!current || current.invocationId !== payload.invocationId || current.status !== "admitted" || !validTimestamp(payload.startedAt)) return null;
    state.control.pendingToolInvocation = {
      ...current,
      status: "dispatched",
      startedAt: payload.startedAt,
      ...(payload.dispatchCorrelationId ? { dispatchCorrelationId: payload.dispatchCorrelationId } : {}),
    };
  } else if (payload.kind === "invocation_terminal") {
    const current = state.control.pendingToolInvocation;
    if (!current || current.invocationId !== payload.invocationId || (current.status !== "admitted" && current.status !== "dispatched")) return null;
    state.control.pendingToolInvocation = {
      ...current,
      status: payload.status,
      ...(payload.terminalCorrelationId ? { terminalCorrelationId: payload.terminalCorrelationId } : {}),
    };
  } else if (payload.kind === "prepared_operation_recorded") {
    if (!validPreparedOperation(payload.operation)) return null;
    const current = state.control.preparedOperation;
    if (current && current.status !== "invalidated" && current.operationId !== payload.operation.operationId) return null;
    state.control.preparedOperation = payload.operation;
  } else if (payload.kind === "prepared_operation_status_changed") {
    const current = state.control.preparedOperation;
    if (!current || current.operationId !== payload.operationId || current.operationFingerprint !== payload.operationFingerprint) return null;
    const allowed =
      payload.status === current.status ||
      (current.status === "prepared" && (payload.status === "approval_required" || payload.status === "approved" || payload.status === "invalidated")) ||
      (current.status === "approval_required" && (payload.status === "approved" || payload.status === "invalidated")) ||
      (current.status === "approved" && payload.status === "invalidated");
    if (!allowed) return null;
    state.control.preparedOperation = { ...current, status: payload.status };
  } else if (payload.kind === "dialogue_anchor_set") {
    if (payload.anchor.anchorId.trim().length === 0 || payload.anchor.dependencyPaths.length === 0) return null;
    state.control.dialogueAnchor = payload.anchor;
  } else if (payload.kind === "dialogue_anchor_clear") {
    const current = state.control.dialogueAnchor;
    if (payload.anchorId && current?.anchorId !== payload.anchorId) return null;
    if (current) delete state.control.dialogueAnchor;
  } else {
    const current = state.lifecycle;
    const next = payload.lifecycle;
    const allowed = current === next || (current === "active" && next !== "active");
    if (!allowed) return null;
    if (current !== next) {
      state.lifecycle = next;
      changed.add("lifecycle");
    }
  }

  return { changed, invalidations: applyCausalInvalidation(state, changed) };
}

function stateInvariantsHold(state: Readonly<TaskState>): boolean {
  if (!validUserSemantics(state.user)) return false;
  if (state.recentEventIds.length > RECENT_EVENT_WINDOW) return false;

  const selection = state.control.groundedSelection;
  if (selection) {
    const availability = state.observations.availability;
    if (!availability || selection.sourceObservationId !== availability.observationId) return false;
    const candidateIds = new Set(availability.rooms.map((room) => room.roomId));
    if (selection.roomIds.some((roomId) => !candidateIds.has(roomId))) return false;
  }

  const bookingTarget = state.control.groundedBookingTarget;
  if (bookingTarget) {
    const booking = state.observations.booking;
    if (!booking || bookingTarget.sourceObservationId !== booking.observationId || bookingTarget.bookingId !== booking.bookingId) return false;
  }

  return true;
}

function rejected(state: Readonly<TaskState>, reason: TaskStateRejection): TaskStateReduction {
  return {
    state: state as TaskState,
    accepted: false,
    material: false,
    duplicate: false,
    invalidations: [],
    rejection: reason,
  };
}

function accepted(state: TaskState, eventId: string, invalidations: readonly TaskStateInvalidation[]): TaskStateReduction {
  state.stateRevision += 1;
  state.recentEventIds = [...state.recentEventIds, eventId].slice(-RECENT_EVENT_WINDOW);
  return {
    state,
    accepted: true,
    material: true,
    duplicate: false,
    invalidations,
  };
}

/** Pure deterministic TaskState transition. Persistence/CAS occurs outside. */
export function reduceTaskState(current: Readonly<TaskState>, event: TaskEvent): TaskStateReduction {
  if (event.sessionId !== current.sessionId) return rejected(current, "wrong_session");
  if (event.taskId !== current.taskId) return rejected(current, "wrong_task");

  if (current.recentEventIds.includes(event.eventId)) {
    return {
      state: current as TaskState,
      accepted: true,
      material: false,
      duplicate: true,
      invalidations: [],
    };
  }

  if (event.expectedStateRevision !== current.stateRevision) return rejected(current, "stale_state_revision");

  const next = cloneState(current);
  let invalidations: readonly TaskStateInvalidation[] = [];

  if (event.kind === "user_semantic") {
    const changed = applyUserPatch(next, (event as UserSemanticEvent).payload);
    if (!changed) return rejected(current, "invalid_user_semantics");
    invalidations = applyCausalInvalidation(next, changed);
  } else if (event.kind === "tool_observation") {
    const result = applyToolEvent(next, event as ToolObservationEvent);
    if (!result) return rejected(current, "invalid_tool_authority");
    invalidations = result.invalidations;
  } else {
    const result = applyServerEvent(next, event as ServerControlEvent);
    if (!result) return rejected(current, "invalid_server_control");
    invalidations = result.invalidations;
  }

  if (!stateInvariantsHold(next)) return rejected(current, "state_invariant_violation");
  return accepted(next, event.eventId, invalidations);
}
