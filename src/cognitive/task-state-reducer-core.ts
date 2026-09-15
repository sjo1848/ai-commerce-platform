import type {
  DependencyBound,
  DependencyPath,
  ExecutionResult,
  PendingToolInvocation,
  PreparedOperation,
  TaskState,
  ToolFailure,
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
const EXECUTION_RESULT_WINDOW = 16;
const MAX_GUESTS = 20;
const MAX_ROOM_COUNT = 10;
const MAX_PREFERENCES = 32;

const DEPENDENCY_PATHS = new Set<DependencyPath>([
  "lifecycle",
  "user.requestedGoal",
  "user.stay.checkIn",
  "user.stay.checkOut",
  "user.stay.guests",
  "user.preferences",
  "user.requestedSelectionReference",
  "user.requestedRoomCount",
  "user.requestedOccupancy",
  "user.operationIntent",
  "user.bookingReference",
  "user.ambiguity",
  "observations.availability",
  "observations.quote",
  "observations.booking",
  "control.groundedSelection",
  "control.groundedBookingTarget",
  "control.pendingToolInvocation",
  "control.preparedOperation",
  "control.dialogueAnchor",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneState(state: Readonly<TaskState>): TaskState {
  return JSON.parse(JSON.stringify(state)) as TaskState;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
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

function validStay(stay: Readonly<UserRequestedSemantics["stay"]>): boolean {
  if (stay.checkIn !== undefined && !validIsoDate(stay.checkIn)) return false;
  if (stay.checkOut !== undefined && !validIsoDate(stay.checkOut)) return false;
  if (stay.checkIn !== undefined && stay.checkOut !== undefined && stay.checkIn >= stay.checkOut) return false;
  if (stay.guests !== undefined && (!Number.isInteger(stay.guests) || stay.guests < 1 || stay.guests > MAX_GUESTS)) return false;
  return true;
}

function validReference(reference: unknown): boolean {
  if (!isRecord(reference) || !nonEmptyString(reference.kind)) return false;
  if (reference.kind === "room_number") {
    return hasOnlyKeys(reference, ["kind", "value"]) && nonEmptyString(reference.value);
  }
  if (reference.kind === "ordinal") {
    return hasOnlyKeys(reference, ["kind", "value"]) && Number.isInteger(reference.value) && Number(reference.value) > 0;
  }
  if (reference.kind === "ordinal_set") {
    return hasOnlyKeys(reference, ["kind", "values"]) && Array.isArray(reference.values) && reference.values.length > 0 && reference.values.every((value) => Number.isInteger(value) && Number(value) > 0);
  }
  if (reference.kind === "relation") {
    return hasOnlyKeys(reference, ["kind", "value"]) && (reference.value === "other" || reference.value === "both");
  }
  if (reference.kind === "contextual_anchor") {
    return hasOnlyKeys(reference, ["kind", "role"]) && (reference.role === "focused_entity" || reference.role === "current_selection" || reference.role === "presented_set");
  }
  if (reference.kind === "visible_reference") {
    return hasOnlyKeys(reference, ["kind", "value"]) && nonEmptyString(reference.value);
  }
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

function expectedGoalForIntent(intent: UserRequestedSemantics["operationIntent"]): UserRequestedSemantics["requestedGoal"] {
  if (intent === "reserve") return "reservation";
  if (intent === "cancel") return "cancellation";
  if (intent === "modify") return "modification";
  return undefined;
}

function validUserSemantics(semantics: Readonly<UserRequestedSemantics>): boolean {
  if (!validStay(semantics.stay)) return false;
  if (semantics.preferences.length > MAX_PREFERENCES) return false;
  if (semantics.preferences.some((value) => typeof value !== "string" || value.trim().length === 0 || value.length > 200)) return false;
  if (semantics.requestedSelectionReference !== undefined && !validReference(semantics.requestedSelectionReference)) return false;
  if (semantics.bookingReference !== undefined && !validReference(semantics.bookingReference)) return false;
  if (semantics.requestedRoomCount !== undefined && (!Number.isInteger(semantics.requestedRoomCount) || semantics.requestedRoomCount < 1 || semantics.requestedRoomCount > MAX_ROOM_COUNT)) return false;
  if (semantics.ambiguity !== undefined && (!nonEmptyString(semantics.ambiguity.code) || semantics.ambiguity.code.length > 100)) return false;
  if (semantics.operationIntent !== undefined && semantics.requestedGoal !== undefined && expectedGoalForIntent(semantics.operationIntent) !== semantics.requestedGoal) return false;
  return validOccupancy(semantics.requestedOccupancy, semantics);
}

function validExplicitPatch(value: unknown): boolean {
  if (!isRecord(value) || (value.op !== "set" && value.op !== "clear")) return false;
  if (value.op === "clear") return hasOnlyKeys(value, ["op"]);
  return hasOnlyKeys(value, ["op", "value"]) && Object.prototype.hasOwnProperty.call(value, "value");
}

function validUserSemanticPatchShape(patch: unknown): patch is UserSemanticPatch {
  if (!isRecord(patch) || !hasOnlyKeys(patch, [
    "requestedGoal",
    "stay",
    "preferences",
    "requestedSelectionReference",
    "requestedRoomCount",
    "requestedOccupancy",
    "operationIntent",
    "bookingReference",
    "ambiguity",
  ])) return false;

  for (const key of ["requestedGoal", "preferences", "requestedSelectionReference", "requestedRoomCount", "requestedOccupancy", "operationIntent", "bookingReference", "ambiguity"] as const) {
    if (patch[key] !== undefined && !validExplicitPatch(patch[key])) return false;
  }

  if (patch.stay !== undefined) {
    if (!isRecord(patch.stay) || !hasOnlyKeys(patch.stay, ["checkIn", "checkOut", "guests"])) return false;
    for (const key of ["checkIn", "checkOut", "guests"] as const) {
      if (patch.stay[key] !== undefined && !validExplicitPatch(patch.stay[key])) return false;
    }
  }
  return true;
}

function validAuthorityShape(value: unknown): value is ToolAuthorityRef {
  if (!isRecord(value) || !nonEmptyString(value.kind) || !nonEmptyString(value.dependencyFingerprint)) return false;
  if (value.kind === "invocation") {
    return hasOnlyKeys(value, ["kind", "invocationId", "dependencyFingerprint"]) && nonEmptyString(value.invocationId);
  }
  if (value.kind === "operation") {
    return hasOnlyKeys(value, ["kind", "operationId", "operationFingerprint", "dependencyFingerprint"]) && nonEmptyString(value.operationId) && nonEmptyString(value.operationFingerprint);
  }
  return false;
}

function validToolPayloadShape(payload: unknown): boolean {
  if (!isRecord(payload) || !nonEmptyString(payload.kind)) return false;
  if (payload.kind === "availability" || payload.kind === "quote" || payload.kind === "booking") {
    return hasOnlyKeys(payload, ["kind", "authority", "observation"]) && validAuthorityShape(payload.authority) && isRecord(payload.observation);
  }
  if (payload.kind === "execution_succeeded") {
    return hasOnlyKeys(payload, ["kind", "authority", "operationType", "observationId"]) && validAuthorityShape(payload.authority) && payload.authority.kind === "operation" && (payload.operationType === "reserve" || payload.operationType === "cancel" || payload.operationType === "modify") && (payload.observationId === undefined || nonEmptyString(payload.observationId));
  }
  if (payload.kind === "failure") {
    return hasOnlyKeys(payload, ["kind", "authority", "failure"]) && validAuthorityShape(payload.authority) && isRecord(payload.failure);
  }
  return false;
}

function validServerPayloadShape(payload: unknown): boolean {
  if (!isRecord(payload) || !nonEmptyString(payload.kind)) return false;
  if (payload.kind === "reference_grounded") return hasOnlyKeys(payload, ["kind", "groundedSelection"]) && isRecord(payload.groundedSelection);
  if (payload.kind === "booking_reference_grounded") return hasOnlyKeys(payload, ["kind", "groundedBookingTarget"]) && isRecord(payload.groundedBookingTarget);
  if (payload.kind === "invocation_recorded") return hasOnlyKeys(payload, ["kind", "invocation"]) && isRecord(payload.invocation);
  if (payload.kind === "invocation_dispatched") return hasOnlyKeys(payload, ["kind", "invocationId", "startedAt", "dispatchCorrelationId"]) && nonEmptyString(payload.invocationId) && validTimestamp(payload.startedAt) && (payload.dispatchCorrelationId === undefined || nonEmptyString(payload.dispatchCorrelationId));
  if (payload.kind === "invocation_terminal") return hasOnlyKeys(payload, ["kind", "invocationId", "status", "terminalCorrelationId"]) && nonEmptyString(payload.invocationId) && (payload.status === "failed" || payload.status === "superseded" || payload.status === "expired") && (payload.terminalCorrelationId === undefined || nonEmptyString(payload.terminalCorrelationId));
  if (payload.kind === "prepared_operation_recorded") return hasOnlyKeys(payload, ["kind", "operation"]) && isRecord(payload.operation);
  if (payload.kind === "prepared_operation_status_changed") return hasOnlyKeys(payload, ["kind", "operationId", "operationFingerprint", "status"]) && nonEmptyString(payload.operationId) && nonEmptyString(payload.operationFingerprint) && (payload.status === "approval_required" || payload.status === "approved" || payload.status === "invalidated");
  if (payload.kind === "dialogue_anchor_set") return hasOnlyKeys(payload, ["kind", "anchor"]) && isRecord(payload.anchor);
  if (payload.kind === "dialogue_anchor_clear") return hasOnlyKeys(payload, ["kind", "anchorId"]) && (payload.anchorId === undefined || nonEmptyString(payload.anchorId));
  if (payload.kind === "lifecycle_changed") return hasOnlyKeys(payload, ["kind", "lifecycle"]) && (payload.lifecycle === "active" || payload.lifecycle === "completed" || payload.lifecycle === "abandoned" || payload.lifecycle === "superseded");
  return false;
}

function validEventEnvelope(event: unknown): event is TaskEvent {
  if (!isRecord(event) || !hasOnlyKeys(event, ["eventId", "kind", "sessionId", "taskId", "expectedStateRevision", "occurredAt", "causationId", "payload"])) return false;
  if (!nonEmptyString(event.eventId) || !nonEmptyString(event.sessionId) || !nonEmptyString(event.taskId) || !validTimestamp(event.occurredAt)) return false;
  if (!Number.isInteger(event.expectedStateRevision) || Number(event.expectedStateRevision) < 0) return false;
  if (event.causationId !== undefined && !nonEmptyString(event.causationId)) return false;
  if (event.kind === "user_semantic") return validUserSemanticPatchShape(event.payload);
  if (event.kind === "tool_observation") return validToolPayloadShape(event.payload);
  if (event.kind === "server_control") return validServerPayloadShape(event.payload);
  return false;
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

function hasDependency(bound: DependencyBound | { dependencyPaths: readonly DependencyPath[] }, changed: ReadonlySet<DependencyPath>): boolean {
  return bound.dependencyPaths.some((path) => changed.has(path));
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

function validDependencyBound(value: DependencyBound, selfPath?: DependencyPath): boolean {
  if (!nonEmptyString(value.dependencyFingerprint) || !Array.isArray(value.dependencyPaths) || value.dependencyPaths.length === 0) return false;
  const seen = new Set<DependencyPath>();
  for (const path of value.dependencyPaths) {
    if (!DEPENDENCY_PATHS.has(path) || seen.has(path) || path === selfPath) return false;
    seen.add(path);
  }
  return true;
}

function validAvailabilityObservation(value: TaskState["observations"]["availability"]): boolean {
  if (!value || !validDependencyBound(value, "observations.availability") || value.source !== "tool" || value.status !== "observed" || !nonEmptyString(value.observationId) || !validStay(value.query)) return false;
  const ids = value.rooms.map((room) => room.roomId);
  if (ids.some((id) => !nonEmptyString(id)) || new Set(ids).size !== ids.length) return false;
  return value.rooms.every((room) =>
    (room.roomNumber === undefined || nonEmptyString(room.roomNumber)) &&
    (room.roomType === undefined || nonEmptyString(room.roomType)) &&
    (room.capacity === undefined || (Number.isInteger(room.capacity) && room.capacity > 0)),
  );
}

function validQuoteObservation(value: TaskState["observations"]["quote"]): boolean {
  return Boolean(value && validDependencyBound(value, "observations.quote") && value.source === "tool" && value.status === "observed" && nonEmptyString(value.observationId) && nonEmptyString(value.roomId) && Number.isInteger(value.totalCents) && value.totalCents >= 0 && nonEmptyString(value.currency));
}

function validBookingObservation(value: TaskState["observations"]["booking"]): boolean {
  return Boolean(value && validDependencyBound(value, "observations.booking") && value.source === "tool" && nonEmptyString(value.observationId) && nonEmptyString(value.status) && nonEmptyString(value.bookingId));
}

function validFailure(failure: ToolFailure): boolean {
  return validDependencyBound(failure) && nonEmptyString(failure.failureId) && nonEmptyString(failure.capabilityId) && (failure.authorityKind === "invocation" || failure.authorityKind === "operation") && nonEmptyString(failure.authorityId) && nonEmptyString(failure.code) && validTimestamp(failure.occurredAt);
}

function validInvocationShape(invocation: PendingToolInvocation): boolean {
  if (!nonEmptyString(invocation.invocationId) || !nonEmptyString(invocation.capabilityId) || !validDependencyBound(invocation, "control.pendingToolInvocation")) return false;
  if (!invocation.dependencyPaths.includes("lifecycle")) return false;
  if (!validTimestamp(invocation.admittedAt) || !validTimestamp(invocation.leaseExpiresAt) || Date.parse(invocation.leaseExpiresAt) <= Date.parse(invocation.admittedAt)) return false;
  if (invocation.startedAt !== undefined && (!validTimestamp(invocation.startedAt) || Date.parse(invocation.startedAt) < Date.parse(invocation.admittedAt) || Date.parse(invocation.startedAt) > Date.parse(invocation.leaseExpiresAt))) return false;
  if (invocation.dispatchCorrelationId !== undefined && !nonEmptyString(invocation.dispatchCorrelationId)) return false;
  if (invocation.terminalCorrelationId !== undefined && !nonEmptyString(invocation.terminalCorrelationId)) return false;
  return ["admitted", "dispatched", "succeeded", "failed", "superseded", "expired"].includes(invocation.status);
}

function validPreparedOperationShape(operation: PreparedOperation): boolean {
  if (!nonEmptyString(operation.operationId) || !nonEmptyString(operation.operationFingerprint) || !validDependencyBound(operation, "control.preparedOperation")) return false;
  if (!operation.dependencyPaths.includes("lifecycle") || !operation.dependencyPaths.includes("user.operationIntent")) return false;
  if (operation.operationType !== "reserve" && operation.operationType !== "cancel" && operation.operationType !== "modify") return false;
  return operation.status === "prepared" || operation.status === "approval_required" || operation.status === "approved" || operation.status === "invalidated";
}

function validateInvocationAuthority(state: Readonly<TaskState>, authority: Extract<ToolAuthorityRef, { kind: "invocation" }>): boolean {
  const invocation = state.control.pendingToolInvocation;
  return Boolean(invocation && invocation.invocationId === authority.invocationId && invocation.dependencyFingerprint === authority.dependencyFingerprint && (invocation.status === "admitted" || invocation.status === "dispatched"));
}

function validateOperationAuthority(state: Readonly<TaskState>, authority: Extract<ToolAuthorityRef, { kind: "operation" }>): boolean {
  const operation = state.control.preparedOperation;
  return Boolean(operation && operation.operationId === authority.operationId && operation.operationFingerprint === authority.operationFingerprint && operation.dependencyFingerprint === authority.dependencyFingerprint && operation.status !== "invalidated" && operation.status !== "approval_required");
}

function validateToolAuthority(state: Readonly<TaskState>, authority: ToolAuthorityRef): boolean {
  return authority.kind === "invocation" ? validateInvocationAuthority(state, authority) : validateOperationAuthority(state, authority);
}

function applyToolEvent(state: TaskState, event: ToolObservationEvent): { invalidations: TaskStateInvalidation[] } | null {
  const payload = event.payload;
  if (!validateToolAuthority(state, payload.authority)) return null;

  const changed = new Set<DependencyPath>();
  if (payload.kind === "availability") {
    if (payload.authority.kind !== "invocation" || !validAvailabilityObservation(payload.observation) || payload.observation.dependencyFingerprint !== payload.authority.dependencyFingerprint) return null;
    state.observations.availability = payload.observation;
    changed.add("observations.availability");
  } else if (payload.kind === "quote") {
    if (payload.authority.kind !== "invocation" || !validQuoteObservation(payload.observation) || payload.observation.dependencyFingerprint !== payload.authority.dependencyFingerprint) return null;
    state.observations.quote = payload.observation;
    changed.add("observations.quote");
  } else if (payload.kind === "booking") {
    if (!validBookingObservation(payload.observation) || payload.observation.dependencyFingerprint !== payload.authority.dependencyFingerprint) return null;
    state.observations.booking = payload.observation;
    changed.add("observations.booking");
  } else if (payload.kind === "execution_succeeded") {
    if (payload.authority.kind !== "operation") return null;
    const operation = state.control.preparedOperation;
    if (!operation || operation.operationType !== payload.operationType) return null;
    if (payload.observationId !== undefined && state.observations.booking?.observationId !== payload.observationId) return null;
    const result: ExecutionResult = {
      operationId: payload.authority.operationId,
      operationType: payload.operationType,
      status: "succeeded",
      ...(payload.observationId !== undefined ? { observationId: payload.observationId } : {}),
    };
    state.observations.executionResults = [...state.observations.executionResults, result].slice(-EXECUTION_RESULT_WINDOW);
  } else {
    const failure = payload.failure;
    if (!validFailure(failure) || failure.dependencyFingerprint !== payload.authority.dependencyFingerprint) return null;
    const expectedAuthorityId = payload.authority.kind === "invocation" ? payload.authority.invocationId : payload.authority.operationId;
    if (failure.authorityKind !== payload.authority.kind || failure.authorityId !== expectedAuthorityId) return null;
    if (payload.authority.kind === "invocation" && failure.capabilityId !== state.control.pendingToolInvocation?.capabilityId) return null;
    state.observations.failures = [...state.observations.failures, failure].slice(-TOOL_FAILURE_WINDOW);
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

function validDialogueAnchor(anchor: TaskState["control"]["dialogueAnchor"]): boolean {
  if (!anchor || !nonEmptyString(anchor.anchorId) || !Number.isInteger(anchor.createdAtStateRevision) || anchor.createdAtStateRevision < 0) return false;
  if (anchor.dependencyFingerprint !== undefined && !nonEmptyString(anchor.dependencyFingerprint)) return false;
  const bound: DependencyBound = { dependencyFingerprint: anchor.dependencyFingerprint ?? "anchor-local", dependencyPaths: anchor.dependencyPaths };
  if (!validDependencyBound(bound, "control.dialogueAnchor")) return false;
  if (anchor.referencedObservationId !== undefined && !nonEmptyString(anchor.referencedObservationId)) return false;
  if (anchor.candidateScope !== undefined && (anchor.candidateScope.length === 0 || anchor.candidateScope.some((value) => !nonEmptyString(value)))) return false;
  return true;
}

function applyServerEvent(state: TaskState, event: ServerControlEvent): { changed: Set<DependencyPath>; invalidations: TaskStateInvalidation[] } | null {
  const payload = event.payload;
  const changed = new Set<DependencyPath>();

  if (payload.kind === "reference_grounded") {
    const availability = state.observations.availability;
    const grounding = payload.groundedSelection;
    if (!availability || grounding.authority !== "server" || !validDependencyBound(grounding, "control.groundedSelection")) return null;
    if (grounding.sourceObservationId !== availability.observationId || !grounding.dependencyPaths.includes("observations.availability") || !grounding.dependencyPaths.includes("user.requestedSelectionReference")) return null;
    const candidateIds = new Set(availability.rooms.map((room) => room.roomId));
    if (grounding.roomIds.length === 0 || new Set(grounding.roomIds).size !== grounding.roomIds.length || grounding.roomIds.some((roomId) => !candidateIds.has(roomId))) return null;
    if (!sameValue(state.control.groundedSelection, grounding)) {
      state.control.groundedSelection = grounding;
      changed.add("control.groundedSelection");
    }
  } else if (payload.kind === "booking_reference_grounded") {
    const booking = state.observations.booking;
    const grounding = payload.groundedBookingTarget;
    if (!booking || grounding.authority !== "server" || !validDependencyBound(grounding, "control.groundedBookingTarget")) return null;
    if (grounding.sourceObservationId !== booking.observationId || grounding.bookingId !== booking.bookingId || !grounding.dependencyPaths.includes("observations.booking") || !grounding.dependencyPaths.includes("user.bookingReference")) return null;
    if (!sameValue(state.control.groundedBookingTarget, grounding)) {
      state.control.groundedBookingTarget = grounding;
      changed.add("control.groundedBookingTarget");
    }
  } else if (payload.kind === "invocation_recorded") {
    if (state.lifecycle !== "active" || !validInvocationShape(payload.invocation) || payload.invocation.status !== "admitted") return null;
    const current = state.control.pendingToolInvocation;
    if (current && (current.status === "admitted" || current.status === "dispatched") && current.invocationId !== payload.invocation.invocationId) return null;
    state.control.pendingToolInvocation = payload.invocation;
  } else if (payload.kind === "invocation_dispatched") {
    const current = state.control.pendingToolInvocation;
    if (!current || current.invocationId !== payload.invocationId || current.status !== "admitted") return null;
    if (Date.parse(payload.startedAt) < Date.parse(current.admittedAt) || Date.parse(payload.startedAt) > Date.parse(current.leaseExpiresAt)) return null;
    state.control.pendingToolInvocation = {
      ...current,
      status: "dispatched",
      startedAt: payload.startedAt,
      ...(payload.dispatchCorrelationId !== undefined ? { dispatchCorrelationId: payload.dispatchCorrelationId } : {}),
    };
  } else if (payload.kind === "invocation_terminal") {
    const current = state.control.pendingToolInvocation;
    if (!current || current.invocationId !== payload.invocationId || (current.status !== "admitted" && current.status !== "dispatched")) return null;
    state.control.pendingToolInvocation = {
      ...current,
      status: payload.status,
      ...(payload.terminalCorrelationId !== undefined ? { terminalCorrelationId: payload.terminalCorrelationId } : {}),
    };
  } else if (payload.kind === "prepared_operation_recorded") {
    if (state.lifecycle !== "active" || !validPreparedOperationShape(payload.operation) || payload.operation.status !== "prepared") return null;
    if (state.user.operationIntent !== payload.operation.operationType) return null;
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
    if (!validDialogueAnchor(payload.anchor)) return null;
    state.control.dialogueAnchor = payload.anchor;
  } else if (payload.kind === "dialogue_anchor_clear") {
    const current = state.control.dialogueAnchor;
    if (payload.anchorId !== undefined && current?.anchorId !== payload.anchorId) return null;
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
  if (state.schemaVersion !== "acp-task-state-v1" || !nonEmptyString(state.sessionId) || !nonEmptyString(state.taskId)) return false;
  if (!Number.isInteger(state.stateRevision) || state.stateRevision < 0 || !validUserSemantics(state.user)) return false;
  if (!Array.isArray(state.recentEventIds) || state.recentEventIds.length > RECENT_EVENT_WINDOW || state.recentEventIds.some((id) => !nonEmptyString(id)) || new Set(state.recentEventIds).size !== state.recentEventIds.length) return false;
  if (!Array.isArray(state.observations.executionResults) || !Array.isArray(state.observations.failures)) return false;
  if (state.observations.availability !== undefined && !validAvailabilityObservation(state.observations.availability)) return false;
  if (state.observations.quote !== undefined && !validQuoteObservation(state.observations.quote)) return false;
  if (state.observations.booking !== undefined && !validBookingObservation(state.observations.booking)) return false;
  if (state.observations.failures.some((failure) => !validFailure(failure))) return false;
  if (state.observations.executionResults.some((result) => !nonEmptyString(result.operationId) || (result.operationType !== "reserve" && result.operationType !== "cancel" && result.operationType !== "modify") || (result.status !== "succeeded" && result.status !== "failed") || (result.observationId !== undefined && !nonEmptyString(result.observationId)))) return false;

  const selection = state.control.groundedSelection;
  if (selection) {
    const availability = state.observations.availability;
    if (!availability || !validDependencyBound(selection, "control.groundedSelection") || selection.authority !== "server" || selection.sourceObservationId !== availability.observationId || !selection.dependencyPaths.includes("observations.availability") || !selection.dependencyPaths.includes("user.requestedSelectionReference")) return false;
    const candidateIds = new Set(availability.rooms.map((room) => room.roomId));
    if (selection.roomIds.length === 0 || selection.roomIds.some((roomId) => !candidateIds.has(roomId))) return false;
  }

  const bookingTarget = state.control.groundedBookingTarget;
  if (bookingTarget) {
    const booking = state.observations.booking;
    if (!booking || !validDependencyBound(bookingTarget, "control.groundedBookingTarget") || bookingTarget.authority !== "server" || bookingTarget.sourceObservationId !== booking.observationId || bookingTarget.bookingId !== booking.bookingId || !bookingTarget.dependencyPaths.includes("observations.booking") || !bookingTarget.dependencyPaths.includes("user.bookingReference")) return false;
  }

  if (state.control.pendingToolInvocation !== undefined && !validInvocationShape(state.control.pendingToolInvocation)) return false;
  if (state.control.preparedOperation !== undefined && !validPreparedOperationShape(state.control.preparedOperation)) return false;
  if (state.control.dialogueAnchor !== undefined && !validDialogueAnchor(state.control.dialogueAnchor)) return false;
  return true;
}

function rejected(state: Readonly<TaskState>, reason: TaskStateRejection): TaskStateReduction {
  return { state: state as TaskState, accepted: false, material: false, duplicate: false, invalidations: [], rejection: reason };
}

function accepted(state: TaskState, eventId: string, invalidations: readonly TaskStateInvalidation[]): TaskStateReduction {
  state.stateRevision += 1;
  state.recentEventIds = [...state.recentEventIds, eventId].slice(-RECENT_EVENT_WINDOW);
  return { state, accepted: true, material: true, duplicate: false, invalidations };
}

/** Pure deterministic TaskState transition. Persistence/CAS occurs outside. */
export function reduceTaskState(current: Readonly<TaskState>, event: TaskEvent): TaskStateReduction {
  if (!stateInvariantsHold(current)) return rejected(current, "state_invariant_violation");
  if (!validEventEnvelope(event)) return rejected(current, "invalid_event_envelope");
  if (event.sessionId !== current.sessionId) return rejected(current, "wrong_session");
  if (event.taskId !== current.taskId) return rejected(current, "wrong_task");

  if (current.recentEventIds.includes(event.eventId)) {
    return { state: current as TaskState, accepted: true, material: false, duplicate: true, invalidations: [] };
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
