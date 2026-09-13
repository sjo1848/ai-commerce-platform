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
  | "grounded_selection"
  | "pending_tool_invocation"
  | "prepared_operation";

export type ReductionResult = {
  nextState: TaskStateV1;
  accepted: boolean;
  materialChange: boolean;
  replayed: boolean;
  invalidations: readonly ReductionInvalidation[];
  rejectionReason?: "TASK_SCOPE_MISMATCH" | "STALE_DEPENDENCY" | "INVALID_GROUNDING";
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
  invocationId: string,
  dependencyFingerprint: DependencyFingerprint,
): boolean {
  return state.pendingToolInvocation?.status === "pending"
    && state.pendingToolInvocation.capabilityId === "availability"
    && state.pendingToolInvocation.invocationId === invocationId
    && state.pendingToolInvocation.dependencyFingerprint === dependencyFingerprint;
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

  const next = structuredClone(state) as TaskStateV1;
  const invalidations: ReductionInvalidation[] = [];
  let materialChange = false;

  if (event.kind === "user_semantic") {
    materialChange = reduceUserSemanticEvent(next, event, invalidations);
  } else if (event.kind === "tool_invocation_started") {
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
    }
  } else if (event.kind === "availability_observed") {
    if (!matchingPending(next, event.invocationId, event.dependencyFingerprint)) {
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
    if (!matchingPending(next, event.invocationId, event.dependencyFingerprint)) {
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
    next.preparedOperation = structuredClone(event.operation);
    materialChange = true;
  } else if (event.kind === "lifecycle_changed") {
    materialChange = next.lifecycle !== event.lifecycle;
    next.lifecycle = event.lifecycle;
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
