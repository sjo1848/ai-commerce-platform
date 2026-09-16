import type { TaskState } from "./contracts.js";
import type { TaskEvent, TaskStateRejection } from "./events.js";

type R = Record<string, unknown>;
const rec = (v: unknown): v is R => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v: R, allowed: readonly string[]) => Object.keys(v).every((k) => allowed.includes(k));
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const arr = (v: unknown) => Array.isArray(v);

function patch(v: unknown): boolean {
  return rec(v) && (v.op === "clear" ? keys(v, ["op"]) : v.op === "set" && keys(v, ["op", "value"]) && Object.prototype.hasOwnProperty.call(v, "value"));
}
function dep(v: R): boolean {
  return str(v.dependencyFingerprint) && arr(v.dependencyPaths) && v.dependencyPaths.length > 0 && v.dependencyPaths.every(str);
}
function ref(v: unknown): boolean {
  if (!rec(v) || !str(v.kind)) return false;
  if (v.kind === "room_number" || v.kind === "ordinal" || v.kind === "relation" || v.kind === "visible_reference") return keys(v, ["kind", "value"]);
  if (v.kind === "ordinal_set") return keys(v, ["kind", "values"]) && arr(v.values);
  if (v.kind === "contextual_anchor") return keys(v, ["kind", "role"]);
  return false;
}
function occupancy(v: unknown): boolean {
  if (!rec(v)) return false;
  if (v.kind === "ordered_distribution") return keys(v, ["kind", "guestsPerRoom"]) && arr(v.guestsPerRoom);
  if (v.kind === "explicit_assignments") return keys(v, ["kind", "assignments"]) && arr(v.assignments) && v.assignments.every((x) => rec(x) && keys(x, ["room", "guests"]) && ref(x.room));
  return false;
}
function semantics(v: unknown): boolean {
  if (!rec(v) || !keys(v, ["requestedGoal", "stay", "preferences", "requestedSelectionReference", "requestedRoomCount", "requestedOccupancy", "operationIntent", "bookingReference", "ambiguity"])) return false;
  if (!rec(v.stay) || !keys(v.stay, ["checkIn", "checkOut", "guests"]) || !arr(v.preferences)) return false;
  if (v.requestedSelectionReference !== undefined && !ref(v.requestedSelectionReference)) return false;
  if (v.bookingReference !== undefined && !ref(v.bookingReference)) return false;
  if (v.requestedOccupancy !== undefined && !occupancy(v.requestedOccupancy)) return false;
  if (v.ambiguity !== undefined && (!rec(v.ambiguity) || !keys(v.ambiguity, ["code", "field"]))) return false;
  return true;
}
function authority(v: unknown): boolean {
  if (!rec(v) || !str(v.kind)) return false;
  if (v.kind === "invocation") return keys(v, ["kind", "invocationId", "dependencyFingerprint"]);
  if (v.kind === "operation") return keys(v, ["kind", "operationId", "operationFingerprint", "dependencyFingerprint"]);
  return false;
}
function availability(v: unknown): boolean {
  if (!rec(v) || !keys(v, ["observationId", "status", "source", "query", "rooms", "dependencyFingerprint", "dependencyPaths"]) || !dep(v)) return false;
  if (!rec(v.query) || !keys(v.query, ["checkIn", "checkOut", "guests"]) || !arr(v.rooms)) return false;
  return v.rooms.every((room) => rec(room) && keys(room, ["roomId", "roomNumber", "roomType", "capacity"]));
}
function quote(v: unknown): boolean {
  return rec(v) && keys(v, ["observationId", "status", "source", "roomId", "totalCents", "currency", "dependencyFingerprint", "dependencyPaths"]) && dep(v);
}
function booking(v: unknown): boolean {
  return rec(v) && keys(v, ["observationId", "status", "source", "bookingId", "dependencyFingerprint", "dependencyPaths"]) && dep(v);
}
function failure(v: unknown): boolean {
  return rec(v) && keys(v, ["failureId", "capabilityId", "authorityKind", "authorityId", "code", "occurredAt", "dependencyFingerprint", "dependencyPaths"]) && dep(v);
}
function invocation(v: unknown): boolean {
  return rec(v) && keys(v, ["invocationId", "capabilityId", "status", "dependencyFingerprint", "dependencyPaths", "inputSnapshot", "admittedAt", "startedAt", "leaseExpiresAt", "dispatchCorrelationId", "terminalCorrelationId"]) && dep(v) && rec(v.inputSnapshot);
}
function operation(v: unknown): boolean {
  if (!rec(v) || !keys(v, ["operationId", "operationType", "operationFingerprint", "capabilityId", "capabilityContractIdentity", "dependencyFingerprint", "dependencyPaths", "inputSnapshot", "status"]) || !dep(v) || !rec(v.inputSnapshot)) return false;
  if ((v.capabilityId === undefined) !== (v.capabilityContractIdentity === undefined)) return false;
  if (v.capabilityId !== undefined && (!str(v.capabilityId) || !str(v.capabilityContractIdentity))) return false;
  return true;
}
function selection(v: unknown): boolean {
  return rec(v) && keys(v, ["roomIds", "sourceObservationId", "authority", "dependencyFingerprint", "dependencyPaths"]) && dep(v) && arr(v.roomIds);
}
function bookingTarget(v: unknown): boolean {
  return rec(v) && keys(v, ["bookingId", "sourceObservationId", "authority", "dependencyFingerprint", "dependencyPaths"]) && dep(v);
}
function anchor(v: unknown): boolean {
  if (!rec(v) || !keys(v, ["anchorId", "kind", "createdAtStateRevision", "dependencyFingerprint", "dependencyPaths", "referencedObservationId", "candidateScope", "focusedCandidate", "selectedCandidates"])) return false;
  if (!arr(v.dependencyPaths) || (v.candidateScope !== undefined && !arr(v.candidateScope))) return false;
  if (v.focusedCandidate !== undefined && !str(v.focusedCandidate)) return false;
  if (v.selectedCandidates !== undefined && (!arr(v.selectedCandidates) || v.selectedCandidates.length === 0 || !v.selectedCandidates.every(str))) return false;
  return true;
}
function execution(v: unknown): boolean {
  return rec(v) && keys(v, ["operationId", "operationType", "status", "observationId"]);
}
function observations(v: unknown): boolean {
  if (!rec(v) || !keys(v, ["availability", "quote", "booking", "executionResults", "failures"]) || !arr(v.executionResults) || !arr(v.failures)) return false;
  return (v.availability === undefined || availability(v.availability)) && (v.quote === undefined || quote(v.quote)) && (v.booking === undefined || booking(v.booking)) && v.executionResults.every(execution) && v.failures.every(failure);
}
function control(v: unknown): boolean {
  if (!rec(v) || !keys(v, ["groundedSelection", "groundedBookingTarget", "pendingToolInvocation", "preparedOperation", "dialogueAnchor"])) return false;
  return (v.groundedSelection === undefined || selection(v.groundedSelection)) && (v.groundedBookingTarget === undefined || bookingTarget(v.groundedBookingTarget)) && (v.pendingToolInvocation === undefined || invocation(v.pendingToolInvocation)) && (v.preparedOperation === undefined || operation(v.preparedOperation)) && (v.dialogueAnchor === undefined || anchor(v.dialogueAnchor));
}
function provenance(v: unknown): boolean {
  if (!rec(v) || !keys(v, ["migratedFromConversationState"])) return false;
  if (v.migratedFromConversationState === undefined) return true;
  return rec(v.migratedFromConversationState) && keys(v.migratedFromConversationState, ["semanticMemoryRevision", "roomSelectionRevision", "bookingStateRevision"]);
}

export function stateSchemaClosed(v: unknown): v is TaskState {
  if (!rec(v) || !keys(v, ["schemaVersion", "sessionId", "taskId", "lifecycle", "stateRevision", "recentEventIds", "user", "observations", "control", "provenance"])) return false;
  return arr(v.recentEventIds) && semantics(v.user) && observations(v.observations) && control(v.control) && provenance(v.provenance);
}

function userPayload(v: unknown): boolean {
  if (!rec(v) || !keys(v, ["requestedGoal", "stay", "preferences", "requestedSelectionReference", "requestedRoomCount", "requestedOccupancy", "operationIntent", "bookingReference", "ambiguity"])) return false;
  for (const k of ["requestedGoal", "preferences", "requestedSelectionReference", "requestedRoomCount", "requestedOccupancy", "operationIntent", "bookingReference", "ambiguity"]) if (v[k] !== undefined && !patch(v[k])) return false;
  if (v.stay !== undefined && (!rec(v.stay) || !keys(v.stay, ["checkIn", "checkOut", "guests"]) || Object.values(v.stay).some((x) => !patch(x)))) return false;
  return true;
}
function toolPayload(v: unknown): boolean {
  if (!rec(v) || !str(v.kind)) return false;
  if (v.kind === "availability") return keys(v, ["kind", "authority", "observation"]) && authority(v.authority) && availability(v.observation);
  if (v.kind === "quote") return keys(v, ["kind", "authority", "observation"]) && authority(v.authority) && quote(v.observation);
  if (v.kind === "booking") return keys(v, ["kind", "authority", "observation"]) && authority(v.authority) && booking(v.observation);
  if (v.kind === "execution_succeeded") return keys(v, ["kind", "authority", "operationType", "observationId"]) && authority(v.authority);
  if (v.kind === "failure") return keys(v, ["kind", "authority", "failure"]) && authority(v.authority) && failure(v.failure);
  return false;
}
function serverPayload(v: unknown): boolean {
  if (!rec(v) || !str(v.kind)) return false;
  if (v.kind === "reference_grounded") return keys(v, ["kind", "groundedSelection"]) && selection(v.groundedSelection);
  if (v.kind === "booking_reference_grounded") return keys(v, ["kind", "groundedBookingTarget"]) && bookingTarget(v.groundedBookingTarget);
  if (v.kind === "invocation_recorded") return keys(v, ["kind", "invocation"]) && invocation(v.invocation);
  if (v.kind === "invocation_dispatched") return keys(v, ["kind", "invocationId", "startedAt", "dispatchCorrelationId"]);
  if (v.kind === "invocation_terminal") return keys(v, ["kind", "invocationId", "status", "terminalCorrelationId"]);
  if (v.kind === "prepared_operation_recorded") return keys(v, ["kind", "operation"]) && operation(v.operation);
  if (v.kind === "prepared_operation_status_changed") return keys(v, ["kind", "operationId", "operationFingerprint", "status"]);
  if (v.kind === "dialogue_anchor_set") return keys(v, ["kind", "anchor"]) && anchor(v.anchor);
  if (v.kind === "dialogue_anchor_clear") return keys(v, ["kind", "anchorId"]);
  if (v.kind === "lifecycle_changed") return keys(v, ["kind", "lifecycle"]);
  return false;
}

export function eventSchemaRejection(event: unknown): TaskStateRejection | undefined {
  if (!rec(event) || !str(event.kind) || !rec(event.payload)) return "invalid_event_envelope";
  if (event.kind === "user_semantic") return userPayload(event.payload) ? undefined : "invalid_event_envelope";
  if (event.kind === "tool_observation") return toolPayload(event.payload) ? undefined : "invalid_tool_authority";
  if (event.kind === "server_control") return serverPayload(event.payload) ? undefined : "invalid_server_control";
  return "invalid_event_envelope";
}
