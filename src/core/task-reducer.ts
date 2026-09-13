import type {
  DependencyFingerprint,
  FactProvenance,
  FieldPatch,
  OperationIntent,
  OperationIntentPatchValue,
  TaskDependencyKey,
  TaskFact,
  TaskGoal,
  TaskStateV1,
} from "./task-state.js";
import type { TaskEvent, UserSemanticEvent } from "./task-events.js";

const RECENT_EVENT_LIMIT = 32;

export type ReductionInvalidation =
  | "availability"
  | "quote"
  | "grounded_selection"
  | "pending_tool_invocation"
  | "prepared_operation";

export type ReductionResult = {
  nextState: TaskStateV1;
  accepted: boolean;
  materialChange: boolean;
  replayed: boolean;
  invalidations: readonly ReductionInvalidation[];
  rejectionReason?: "TASK_SCOPE_MISMATCH" | "STATE_REVISION_CONFLICT" | "TASK_NOT_ACTIVE" | "EXECUTION_ALREADY_COMMITTED" | "STALE_DEPENDENCY" | "INVALID_GROUNDING" | "OPERATION_BINDING_MISMATCH" | "INVALID_OPERATION_TRANSITION" | "PENDING_TOOL_CONFLICT";
};

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function intersects(keys: readonly TaskDependencyKey[], changed: ReadonlySet<TaskDependencyKey>): boolean {
  return keys.some((key) => changed.has(key));
}

function addRecentEventId(state: TaskStateV1, eventId: string): void {
  const next = [...state.recentEventIds.filter((item) => item !== eventId), eventId];
  state.recentEventIds = next.slice(-RECENT_EVENT_LIMIT);
}

function pushInvalidation(target: ReductionInvalidation[], value: ReductionInvalidation): void {
  if (!target.includes(value)) target.push(value);
}

function applyFactPatch<T>(
  current: TaskFact<T> | undefined,
  patch: FieldPatch<T> | undefined,
  provenance: FactProvenance,
): { value: TaskFact<T> | undefined; changed: boolean } {
  if (!patch) return { value: current, changed: false };
  if (patch.op === "clear") return { value: undefined, changed: current !== undefined };
  if (current !== undefined && sameValue(current.value, patch.value)) return { value: current, changed: false };
  const next: TaskFact<T> = { value: patch.value, provenance };
  return { value: next, changed: true };
}

function applyOperationIntentPatch(
  current: OperationIntent | undefined,
  patch: FieldPatch<OperationIntentPatchValue> | undefined,
  provenance: FactProvenance,
): { value: OperationIntent | undefined; changed: boolean } {
  if (!patch) return { value: current, changed: false };
  if (patch.op === "clear") return { value: undefined, changed: current !== undefined };
  if (current !== undefined) {
    const { provenance: _currentProvenance, ...currentValue } = current;
    if (sameValue(currentValue, patch.value)) return { value: current, changed: false };
  }
  const next: OperationIntent = { ...patch.value, provenance };
  return { value: next, changed: true };
}

function invalidateDependencies(
  state: TaskStateV1,
  changed: ReadonlySet<TaskDependencyKey>,
  invalidations: ReductionInvalidation[],
): void {
  if (state.availability.status !== "not_queried" && intersects(state.availability.dependencyKeys, changed)) {
    state.availability = { status: "not_queried", rooms: [], dependencyKeys: [] };
    pushInvalidation(invalidations, "availability");
    changed = new Set([...changed, "availability"]);
  }

  if (state.quote.status !== "not_queried" && intersects(state.quote.dependencyKeys, changed)) {
    state.quote = { status: "not_queried", roomIds: [], dependencyKeys: [] };
    pushInvalidation(invalidations, "quote");
    changed = new Set([...changed, "quote"]);
  }

  if (state.groundedSelection.status !== "none" && intersects(state.groundedSelection.dependencyKeys, changed)) {
    state.groundedSelection = {
      ...state.groundedSelection,
      status: "stale",
    };
    pushInvalidation(invalidations, "grounded_selection");
    changed = new Set([...changed, "groundedSelection"]);
  }

  if (state.pendingToolInvocation?.status === "pending" && intersects(state.pendingToolInvocation.dependencyKeys, changed)) {
    state.pendingToolInvocation = { ...state.pendingToolInvocation, status: "superseded" };
    pushInvalidation(invalidations, "pending_tool_invocation");
  }

  if (state.preparedOperation && state.preparedOperation.status !== "invalidated" && intersects(state.preparedOperation.dependencyKeys, changed)) {
    state.preparedOperation = { ...state.preparedOperation, status: "invalidated" };
    pushInvalidation(invalidations, "prepared_operation");
  }
}

function reduceUserSemanticEvent(
  state: TaskStateV1,
  event: UserSemanticEvent,
  invalidations: ReductionInvalidation[],
): boolean {
  const provenance: FactProvenance = { source: "user", revision: event.sourceRevision };
  const changed = new Set<TaskDependencyKey>();

  const goal = applyFactPatch<TaskGoal>(state.requestedGoal, event.patch.requestedGoal, provenance);
  if (goal.changed) {
    if (goal.value) state.requestedGoal = goal.value;
    else delete state.requestedGoal;
    changed.add("requestedGoal");
  }

  const checkIn = applyFactPatch(state.requestedStay.checkIn, event.patch.checkIn, provenance);
  if (checkIn.changed) {
    if (checkIn.value) state.requestedStay.checkIn = checkIn.value;
    else delete state.requestedStay.checkIn;
    changed.add("requestedStay.checkIn");
  }

  const checkOut = applyFactPatch(state.requestedStay.checkOut, event.patch.checkOut, provenance);
  if (checkOut.changed) {
    if (checkOut.value) state.requestedStay.checkOut = checkOut.value;
    else delete state.requestedStay.checkOut;
    changed.add("requestedStay.checkOut");
  }

  const guests = applyFactPatch(state.requestedStay.guests, event.patch.guests, provenance);
  if (guests.changed) {
    if (guests.value) state.requestedStay.guests = guests.value;
    else delete state.requestedStay.guests;
    changed.add("requestedStay.guests");
  }

  const roomCount = applyFactPatch(state.requestedRoomCount, event.patch.requestedRoomCount, provenance);
  if (roomCount.changed) {
    if (roomCount.value) state.requestedRoomCount = roomCount.value;
    else delete state.requestedRoomCount;
    changed.add("requestedRoomCount");
  }

  const selectionRef = applyFactPatch(state.requestedSelectionReference, event.patch.requestedSelectionReference, provenance);
  if (selectionRef.changed) {
    if (selectionRef.value) state.requestedSelectionReference = selectionRef.value;
    else delete state.requestedSelectionReference;
    changed.add("requestedSelectionReference");
  }

  const bookingRef = applyFactPatch(state.bookingReference, event.patch.bookingReference, provenance);
  if (bookingRef.changed) {
    if (bookingRef.value) state.bookingReference = bookingRef.value;
    else delete state.bookingReference;
    changed.add("bookingReference");
  }

  const operationIntent = applyOperationIntentPatch(state.operationIntent, event.patch.operationIntent, provenance);
  if (operationIntent.changed) {
    if (operationIntent.value) state.operationIntent = operationIntent.value;
    else delete state.operationIntent;
    changed.add("operationIntent");
  }

  if (event.patch.preferences) {
    const nextPreferences = event.patch.preferences.op === "clear"
      ? []
      : event.patch.preferences.value.map((value) => ({ value, provenance }));
    const currentPreferenceValues = state.preferences.map((item) => item.value);
    const nextPreferenceValues = nextPreferences.map((item) => item.value);
    if (!sameValue(currentPreferenceValues, nextPreferenceValues)) {
      state.preferences = nextPreferences;
      changed.add("preferences");
    }
  }

  if (changed.size > 0) invalidateDependencies(state, changed, invalidations);
  return changed.size > 0 || invalidations.length > 0;
}

function matchingPending(
  state: TaskStateV1,
  capabilityId: string,
  invocationId: string,
  dependencyFingerprint: DependencyFingerprint,
): boolean {
  return state.pendingToolInvocation?.status === "pending"
    && state.pendingToolInvocation.capabilityId === capabilityId
    && state.pendingToolInvocation.invocationId === invocationId
    && state.pendingToolInvocation.dependencyFingerprint === dependencyFingerprint;
}

function operationMatches(
  state: TaskStateV1,
  operationId: string,
  operationFingerprint: string,
  dependencyFingerprint: string,
): boolean {
  return state.preparedOperation?.operationId === operationId
    && state.preparedOperation.operationFingerprint === operationFingerprint
    && state.preparedOperation.dependencyFingerprint === dependencyFingerprint;
}

function executionMatches(
  state: TaskStateV1,
  operationId: string,
  operationFingerprint: string,
  dependencyFingerprint: string,
): boolean {
  return state.execution.status === "executing"
    && state.execution.operationId === operationId
    && state.execution.operationFingerprint === operationFingerprint
    && state.execution.dependencyFingerprint === dependencyFingerprint;
}

function upsertBooking(state: TaskStateV1, booking: TaskStateV1["bookings"][number]): void {
  const remaining = state.bookings.filter((item) => item.bookingId !== booking.bookingId);
  state.bookings = [...remaining, structuredClone(booking)];
}

export function reduceTaskState(state: Readonly<TaskStateV1>, event: TaskEvent): ReductionResult {
  if (state.taskId !== event.taskId || state.sessionId !== event.sessionId) {
    return {
      nextState: structuredClone(state),
      accepted: false,
      materialChange: false,
      replayed: false,
      invalidations: [],
      rejectionReason: "TASK_SCOPE_MISMATCH",
    };
  }

  if (state.recentEventIds.includes(event.eventId)) {
    return {
      nextState: structuredClone(state),
      accepted: true,
      materialChange: false,
      replayed: true,
      invalidations: [],
    };
  }

  if ("expectedStateRevision" in event && event.expectedStateRevision !== state.stateRevision) {
    return {
      nextState: structuredClone(state),
      accepted: false,
      materialChange: false,
      replayed: false,
      invalidations: [],
      rejectionReason: "STATE_REVISION_CONFLICT",
    };
  }

  if (state.lifecycle !== "active") {
    return {
      nextState: structuredClone(state),
      accepted: false,
      materialChange: false,
      replayed: false,
      invalidations: [],
      rejectionReason: "TASK_NOT_ACTIVE",
    };
  }

  if (event.kind === "user_semantic" && (state.execution.status === "executing" || state.execution.status === "confirmed")) {
    return {
      nextState: structuredClone(state),
      accepted: false,
      materialChange: false,
      replayed: false,
      invalidations: [],
      rejectionReason: "EXECUTION_ALREADY_COMMITTED",
    };
  }

  const next = structuredClone(state) as TaskStateV1;
  const invalidations: ReductionInvalidation[] = [];
  let materialChange = false;

  if (event.kind === "user_semantic") {
    materialChange = reduceUserSemanticEvent(next, event, invalidations);
  } else if (event.kind === "tool_invocation_started") {
    if (next.pendingToolInvocation?.status === "pending") {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "PENDING_TOOL_CONFLICT",
      };
    }
    next.pendingToolInvocation = {
      invocationId: event.invocationId,
      capabilityId: event.capabilityId,
      status: "pending",
      dependencyFingerprint: event.dependencyFingerprint,
      dependencyKeys: [...event.dependencyKeys],
      inputSnapshot: structuredClone(event.inputSnapshot),
      startedAt: event.startedAt,
    };
    materialChange = true;
    if (event.capabilityId === "availability") {
      next.availability = {
        status: "pending",
        dependencyFingerprint: event.dependencyFingerprint,
        dependencyKeys: [...event.dependencyKeys],
        querySnapshot: structuredClone(event.inputSnapshot),
        rooms: [],
      };
      invalidateDependencies(next, new Set<TaskDependencyKey>(["availability"]), invalidations);
    } else if (event.capabilityId === "quote") {
      next.quote = {
        status: "pending",
        dependencyFingerprint: event.dependencyFingerprint,
        dependencyKeys: [...event.dependencyKeys],
        roomIds: [],
      };
      invalidateDependencies(next, new Set<TaskDependencyKey>(["quote"]), invalidations);
    }
  } else if (event.kind === "availability_observed") {
    if (!matchingPending(next, "availability", event.invocationId, event.dependencyFingerprint)) {
      return {
        nextState: structuredClone(state),
        accepted: false,
        materialChange: false,
        replayed: false,
        invalidations: [],
        rejectionReason: "STALE_DEPENDENCY",
      };
    }
    const pending = next.pendingToolInvocation!;
    const priorSelection = next.groundedSelection;
    next.availability = {
      status: "observed",
      observationRevision: event.observationRevision,
      dependencyFingerprint: event.dependencyFingerprint,
      dependencyKeys: [...pending.dependencyKeys],
      querySnapshot: structuredClone(pending.inputSnapshot),
      rooms: event.rooms.map((room) => structuredClone(room)),
      observedAt: event.observedAt,
    };
    next.pendingToolInvocation = { ...pending, status: "succeeded" };
    if (priorSelection.status !== "none") {
      next.groundedSelection = { ...priorSelection, status: "stale" };
      pushInvalidation(invalidations, "grounded_selection");
    }
    materialChange = true;
  } else if (event.kind === "availability_failed") {
    if (!matchingPending(next, "availability", event.invocationId, event.dependencyFingerprint)) {
      return {
        nextState: structuredClone(state),
        accepted: false,
        materialChange: false,
        replayed: false,
        invalidations: [],
        rejectionReason: "STALE_DEPENDENCY",
      };
    }
    const pending = next.pendingToolInvocation!;
    next.availability = {
      status: "failed",
      dependencyFingerprint: event.dependencyFingerprint,
      dependencyKeys: [...pending.dependencyKeys],
      querySnapshot: structuredClone(pending.inputSnapshot),
      rooms: [],
    };
    next.pendingToolInvocation = { ...pending, status: "failed" };
    materialChange = true;
  } else if (event.kind === "quote_observed") {
    if (!matchingPending(next, "quote", event.invocationId, event.dependencyFingerprint)) {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "STALE_DEPENDENCY",
      };
    }
    const pending = next.pendingToolInvocation!;
    next.quote = {
      status: "observed",
      observationRevision: event.observationRevision,
      dependencyFingerprint: event.dependencyFingerprint,
      dependencyKeys: [...pending.dependencyKeys],
      roomIds: [...event.roomIds],
      amountCents: event.amountCents,
      currency: event.currency,
      observedAt: event.observedAt,
    };
    next.pendingToolInvocation = { ...pending, status: "succeeded" };
    materialChange = true;
  } else if (event.kind === "quote_failed") {
    if (!matchingPending(next, "quote", event.invocationId, event.dependencyFingerprint)) {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "STALE_DEPENDENCY",
      };
    }
    const pending = next.pendingToolInvocation!;
    next.quote = {
      status: "failed",
      dependencyFingerprint: event.dependencyFingerprint,
      dependencyKeys: [...pending.dependencyKeys],
      roomIds: [],
    };
    next.pendingToolInvocation = { ...pending, status: "failed" };
    materialChange = true;
  } else if (event.kind === "selection_grounded") {
    const availability = next.availability;
    const allRoomsVisible = availability.status === "observed"
      && availability.observationRevision === event.basedOnAvailabilityRevision
      && event.roomIds.every((roomId) => availability.rooms.some((room) => room.roomId === roomId));
    if (!allRoomsVisible) {
      return {
        nextState: structuredClone(state),
        accepted: false,
        materialChange: false,
        replayed: false,
        invalidations: [],
        rejectionReason: "INVALID_GROUNDING",
      };
    }
    next.groundedSelection = {
      status: "grounded",
      roomIds: [...event.roomIds],
      basedOnAvailabilityRevision: event.basedOnAvailabilityRevision,
      dependencyFingerprint: event.dependencyFingerprint,
      dependencyKeys: [...event.dependencyKeys],
    };
    materialChange = true;
  } else if (event.kind === "operation_prepared") {
    const existingOperationActive = next.preparedOperation && next.preparedOperation.status !== "invalidated";
    if (next.execution.status === "executing" || next.execution.status === "confirmed"
      || (existingOperationActive && next.execution.status !== "failed")) {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "INVALID_OPERATION_TRANSITION",
      };
    }
    next.preparedOperation = structuredClone(event.operation);
    next.execution = { status: "not_started" };
    materialChange = true;
  } else if (event.kind === "approval_state_changed") {
    if (!operationMatches(next, event.operationId, event.operationFingerprint, event.dependencyFingerprint)) {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "OPERATION_BINDING_MISMATCH",
      };
    }
    const operation = next.preparedOperation!;
    if (event.status === "approved" && operation.status !== "approval_required") {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "INVALID_OPERATION_TRANSITION",
      };
    }
    next.preparedOperation = { ...operation, status: event.status };
    materialChange = true;
  } else if (event.kind === "execution_started") {
    if (next.execution.status === "executing" || next.execution.status === "confirmed") {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "INVALID_OPERATION_TRANSITION",
      };
    }
    if (!operationMatches(next, event.operationId, event.operationFingerprint, event.dependencyFingerprint)) {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "OPERATION_BINDING_MISMATCH",
      };
    }
    const operation = next.preparedOperation!;
    if (operation.status !== "prepared" && operation.status !== "approved") {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "INVALID_OPERATION_TRANSITION",
      };
    }
    next.execution = {
      status: "executing",
      operationId: event.operationId,
      operationFingerprint: event.operationFingerprint,
      dependencyFingerprint: event.dependencyFingerprint,
    };
    materialChange = true;
  } else if (event.kind === "booking_created" || event.kind === "booking_cancelled" || event.kind === "booking_modified") {
    if (!executionMatches(next, event.operationId, event.operationFingerprint, event.dependencyFingerprint)) {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "OPERATION_BINDING_MISMATCH",
      };
    }
    upsertBooking(next, event.booking);
    const outcomeKind = event.kind;
    next.execution = {
      status: "confirmed",
      operationId: event.operationId,
      operationFingerprint: event.operationFingerprint,
      dependencyFingerprint: event.dependencyFingerprint,
      outcomeKind,
    };
    materialChange = true;
  } else if (event.kind === "operation_execution_failed") {
    if (!executionMatches(next, event.operationId, event.operationFingerprint, event.dependencyFingerprint)) {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "OPERATION_BINDING_MISMATCH",
      };
    }
    next.execution = {
      status: "failed",
      operationId: event.operationId,
      operationFingerprint: event.operationFingerprint,
      dependencyFingerprint: event.dependencyFingerprint,
      failureCode: event.failureCode,
    };
    materialChange = true;
  } else if (event.kind === "lifecycle_changed") {
    if (event.lifecycle !== "active" && next.execution.status === "executing") {
      return {
        nextState: structuredClone(state), accepted: false, materialChange: false, replayed: false, invalidations: [],
        rejectionReason: "INVALID_OPERATION_TRANSITION",
      };
    }
    materialChange = next.lifecycle !== event.lifecycle;
    next.lifecycle = event.lifecycle;
    if (event.lifecycle !== "active") {
      if (next.pendingToolInvocation?.status === "pending") {
        next.pendingToolInvocation = { ...next.pendingToolInvocation, status: "superseded" };
        pushInvalidation(invalidations, "pending_tool_invocation");
        materialChange = true;
      }
      if (next.execution.status !== "confirmed"
        && next.preparedOperation
        && next.preparedOperation.status !== "invalidated") {
        next.preparedOperation = { ...next.preparedOperation, status: "invalidated" };
        pushInvalidation(invalidations, "prepared_operation");
        materialChange = true;
      }
    }
  }

  addRecentEventId(next, event.eventId);
  if (materialChange) next.stateRevision += 1;

  return {
    nextState: next,
    accepted: true,
    materialChange,
    replayed: false,
    invalidations,
  };
}
