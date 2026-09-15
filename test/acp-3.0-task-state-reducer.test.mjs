import test from "node:test";
import assert from "node:assert/strict";
import { reduceTaskState } from "../dist/cognitive/task-state-reducer.js";
import { dependencyFingerprint } from "../dist/cognitive/fingerprint.js";

const NOW = "2026-09-15T03:30:00.000Z";

function emptyTask() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-1",
    taskId: "task-1",
    lifecycle: "active",
    stateRevision: 0,
    recentEventIds: [],
    user: { stay: {}, preferences: [] },
    observations: { executionResults: [], failures: [] },
    control: {},
    provenance: {},
  };
}
function userEvent(state, eventId, payload) { return { eventId, kind: "user_semantic", sessionId: state.sessionId, taskId: state.taskId, expectedStateRevision: state.stateRevision, occurredAt: NOW, payload }; }
function serverEvent(state, eventId, payload) { return { eventId, kind: "server_control", sessionId: state.sessionId, taskId: state.taskId, expectedStateRevision: state.stateRevision, occurredAt: NOW, payload }; }
function toolEvent(state, eventId, payload) { return { eventId, kind: "tool_observation", sessionId: state.sessionId, taskId: state.taskId, expectedStateRevision: state.stateRevision, occurredAt: NOW, payload }; }
function accept(state, event) {
  const result = reduceTaskState(state, event);
  assert.equal(result.accepted, true, `expected ${event.eventId} accepted: ${result.rejection ?? "unknown"}`);
  assert.equal(result.duplicate, false);
  return result;
}

async function stateWithAvailability() {
  let state = emptyTask();
  state = accept(state, userEvent(state, "u1", {
    requestedGoal: { op: "set", value: "reservation" },
    stay: { checkIn: { op: "set", value: "2027-01-15" }, checkOut: { op: "set", value: "2027-01-17" }, guests: { op: "set", value: 2 } },
  })).state;
  const dependencyPaths = ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"];
  const fp = await dependencyFingerprint({ checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });
  state = accept(state, serverEvent(state, "s1", { kind: "invocation_recorded", invocation: {
    invocationId: "inv-availability-1", capabilityId: "hotel.availability", status: "admitted", dependencyFingerprint: fp, dependencyPaths,
    inputSnapshot: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 }, admittedAt: NOW, leaseExpiresAt: "2026-09-15T03:35:00.000Z",
  }})).state;
  state = accept(state, toolEvent(state, "t1", { kind: "availability", authority: { kind: "invocation", invocationId: "inv-availability-1", dependencyFingerprint: fp }, observation: {
    observationId: "availability-1", status: "observed", source: "tool", query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    rooms: [{ roomId: "room-101", roomNumber: "101", capacity: 2 }, { roomId: "room-102", roomNumber: "102", capacity: 2 }],
    dependencyFingerprint: fp, dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  }})).state;
  return { state, availabilityFp: fp };
}

async function stateWithGroundedSelection() {
  let { state } = await stateWithAvailability();
  state = accept(state, userEvent(state, "u2", { requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 2 } } })).state;
  const selectionFp = await dependencyFingerprint({ observationId: "availability-1", ordinal: 2 });
  state = accept(state, serverEvent(state, "s2", { kind: "reference_grounded", groundedSelection: {
    roomIds: ["room-102"], sourceObservationId: "availability-1", authority: "server", dependencyFingerprint: selectionFp,
    dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
  }})).state;
  return { state, selectionFp };
}

test("envelope is closed and fail-closed", () => {
  const state = emptyTask();
  for (const event of [
    { ...userEvent(state, "", {}), eventId: "" },
    { ...userEvent(state, "u1", {}), occurredAt: "not-a-time" },
    { ...userEvent(state, "u2", {}), unexpected: true },
    { ...userEvent(state, "u3", {}), kind: "mystery" },
  ]) {
    const result = reduceTaskState(state, event);
    assert.equal(result.accepted, false);
    assert.equal(result.rejection, "invalid_event_envelope");
  }
});

test("semantic patch rejects unknown keys and incompatible goal/commit", () => {
  const state = emptyTask();
  const extra = reduceTaskState(state, userEvent(state, "u1", { requestedGoal: { op: "set", value: "reservation" }, toolId: "hms.create" }));
  assert.equal(extra.rejection, "invalid_event_envelope");
  const mismatch = reduceTaskState(state, userEvent(state, "u2", { requestedGoal: { op: "set", value: "availability" }, operationIntent: { op: "set", value: "reserve" } }));
  assert.equal(mismatch.rejection, "invalid_user_semantics");
});

test("revision, duplicate-idempotency and concurrency guards stay intact", () => {
  const initial = emptyTask();
  const event = userEvent(initial, "u1", { requestedGoal: { op: "set", value: "reservation" } });
  const first = accept(initial, event);
  assert.equal(first.state.stateRevision, 1);
  const duplicate = reduceTaskState(first.state, event);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.stateRevision, 1);
  const stale = reduceTaskState(first.state, { ...userEvent(first.state, "u2", {}), expectedStateRevision: 0 });
  assert.equal(stale.rejection, "stale_state_revision");
  const wrong = reduceTaskState(first.state, { ...userEvent(first.state, "u3", {}), sessionId: "other" });
  assert.equal(wrong.rejection, "wrong_session");
});

test("invalid requested state fails atomically", () => {
  const initial = emptyTask();
  const invalidDate = reduceTaskState(initial, userEvent(initial, "u1", { stay: { checkIn: { op: "set", value: "2027-02-30" } } }));
  assert.equal(invalidDate.rejection, "invalid_user_semantics");
  assert.deepEqual(invalidDate.state, initial);
  let state = accept(initial, userEvent(initial, "u2", { stay: { guests: { op: "set", value: 4 } }, requestedRoomCount: { op: "set", value: 2 } })).state;
  const badOccupancy = reduceTaskState(state, userEvent(state, "u3", { requestedOccupancy: { op: "set", value: { kind: "ordered_distribution", guestsPerRoom: [1, 2] } } }));
  assert.equal(badOccupancy.rejection, "invalid_user_semantics");
  assert.equal(badOccupancy.state.stateRevision, state.stateRevision);
});

test("invocations require lifecycle dependency and forbid self-dependency", async () => {
  const state = emptyTask();
  const fp = await dependencyFingerprint({ q: 1 });
  for (const dependencyPaths of [
    ["user.stay.guests"],
    ["lifecycle", "control.pendingToolInvocation"],
  ]) {
    const result = reduceTaskState(state, serverEvent(state, `s-${dependencyPaths.length}-${dependencyPaths.at(-1)}`, { kind: "invocation_recorded", invocation: {
      invocationId: "inv-1", capabilityId: "hotel.availability", status: "admitted", dependencyFingerprint: fp, dependencyPaths,
      inputSnapshot: {}, admittedAt: NOW, leaseExpiresAt: "2026-09-15T03:35:00.000Z",
    }}));
    assert.equal(result.rejection, "invalid_server_control");
  }
});

test("tool truth requires live authority; correction supersedes pending invocation", async () => {
  let state = emptyTask();
  state = accept(state, userEvent(state, "u1", { stay: { checkIn: { op: "set", value: "2027-01-15" }, checkOut: { op: "set", value: "2027-01-17" }, guests: { op: "set", value: 2 } } })).state;
  const fp = await dependencyFingerprint({ checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });
  state = accept(state, serverEvent(state, "s1", { kind: "invocation_recorded", invocation: {
    invocationId: "inv-1", capabilityId: "hotel.availability", status: "admitted", dependencyFingerprint: fp,
    dependencyPaths: ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"], inputSnapshot: {}, admittedAt: NOW, leaseExpiresAt: "2026-09-15T03:35:00.000Z",
  }})).state;
  const correction = accept(state, userEvent(state, "u2", { stay: { checkOut: { op: "set", value: "2027-01-18" } } }));
  state = correction.state;
  assert.equal(state.control.pendingToolInvocation.status, "superseded");
  const late = reduceTaskState(state, toolEvent(state, "t1", { kind: "availability", authority: { kind: "invocation", invocationId: "inv-1", dependencyFingerprint: fp }, observation: {
    observationId: "old", status: "observed", source: "tool", query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 }, rooms: [{ roomId: "room-101" }], dependencyFingerprint: fp,
    dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  }}));
  assert.equal(late.rejection, "invalid_tool_authority");
});

test("server grounding is bounded to current authoritative candidates", async () => {
  let { state } = await stateWithAvailability();
  state = accept(state, userEvent(state, "u2", { requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 1 } } })).state;
  const bad = reduceTaskState(state, serverEvent(state, "s2", { kind: "reference_grounded", groundedSelection: {
    roomIds: ["room-999"], sourceObservationId: "availability-1", authority: "server", dependencyFingerprint: "selection:bad",
    dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
  }}));
  assert.equal(bad.rejection, "invalid_server_control");
  const good = accept(state, serverEvent(state, "s3", { kind: "reference_grounded", groundedSelection: {
    roomIds: ["room-101"], sourceObservationId: "availability-1", authority: "server", dependencyFingerprint: "selection:good",
    dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
  }}));
  assert.deepEqual(good.state.control.groundedSelection.roomIds, ["room-101"]);
});

test("prepared operations bind lifecycle + explicit intent and causal invalidation remains selective", async () => {
  let { state } = await stateWithGroundedSelection();
  state = accept(state, userEvent(state, "u3", { operationIntent: { op: "set", value: "reserve" } })).state;
  const fp = await dependencyFingerprint({ room: "room-102" });
  const bad = reduceTaskState(state, serverEvent(state, "s3-bad", { kind: "prepared_operation_recorded", operation: {
    operationId: "op-bad", operationType: "cancel", operationFingerprint: "operation:bad", dependencyFingerprint: fp,
    dependencyPaths: ["lifecycle", "control.groundedSelection", "user.operationIntent"], inputSnapshot: {}, status: "prepared",
  }}));
  assert.equal(bad.rejection, "invalid_server_control");
  state = accept(state, serverEvent(state, "s3", { kind: "prepared_operation_recorded", operation: {
    operationId: "op-1", operationType: "reserve", operationFingerprint: "operation:1", dependencyFingerprint: fp,
    dependencyPaths: ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "control.groundedSelection", "user.operationIntent"], inputSnapshot: { roomId: "room-102" }, status: "prepared",
  }})).state;
  const unrelated = accept(state, userEvent(state, "u4", { preferences: { op: "set", value: ["piso alto"] } }));
  assert.equal(unrelated.state.control.preparedOperation.status, "prepared");
  const corrected = accept(unrelated.state, userEvent(unrelated.state, "u5", { stay: { checkOut: { op: "set", value: "2027-01-18" } } }));
  assert.equal(corrected.state.observations.availability, undefined);
  assert.equal(corrected.state.control.groundedSelection, undefined);
  assert.equal(corrected.state.control.preparedOperation.status, "invalidated");
});

test("approval cannot be bypassed and execution success must match the prepared operation type", async () => {
  let { state } = await stateWithGroundedSelection();
  state = accept(state, userEvent(state, "u3", { operationIntent: { op: "set", value: "reserve" } })).state;
  const fp = await dependencyFingerprint({ room: "room-102" });
  state = accept(state, serverEvent(state, "s3", { kind: "prepared_operation_recorded", operation: {
    operationId: "op-1", operationType: "reserve", operationFingerprint: "operation:1", dependencyFingerprint: fp,
    dependencyPaths: ["lifecycle", "control.groundedSelection", "user.operationIntent"], inputSnapshot: { roomId: "room-102" }, status: "prepared",
  }})).state;
  state = accept(state, serverEvent(state, "s4", { kind: "prepared_operation_status_changed", operationId: "op-1", operationFingerprint: "operation:1", status: "approval_required" })).state;
  const authority = { kind: "operation", operationId: "op-1", operationFingerprint: "operation:1", dependencyFingerprint: fp };
  const bypass = reduceTaskState(state, toolEvent(state, "t2", { kind: "booking", authority, observation: {
    observationId: "booking-1", status: "CONFIRMED", source: "tool", bookingId: "BK-1", dependencyFingerprint: fp, dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
  }}));
  assert.equal(bypass.rejection, "invalid_tool_authority");
  state = accept(state, serverEvent(state, "s5", { kind: "prepared_operation_status_changed", operationId: "op-1", operationFingerprint: "operation:1", status: "approved" })).state;
  const wrongType = reduceTaskState(state, toolEvent(state, "t3", { kind: "execution_succeeded", authority, operationType: "cancel" }));
  assert.equal(wrongType.rejection, "invalid_tool_authority");
  state = accept(state, toolEvent(state, "t4", { kind: "booking", authority, observation: {
    observationId: "booking-1", status: "CONFIRMED", source: "tool", bookingId: "BK-1", dependencyFingerprint: fp, dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
  }})).state;
  state = accept(state, toolEvent(state, "t5", { kind: "execution_succeeded", authority, operationType: "reserve", observationId: "booking-1" })).state;
  assert.equal(state.observations.executionResults.at(-1)?.status, "succeeded");
});

test("tool failure authority must match exact invocation identity and capability", async () => {
  let state = emptyTask();
  const fp = await dependencyFingerprint({ q: 1 });
  state = accept(state, serverEvent(state, "s1", { kind: "invocation_recorded", invocation: {
    invocationId: "inv-1", capabilityId: "hotel.availability", status: "admitted", dependencyFingerprint: fp,
    dependencyPaths: ["lifecycle", "user.stay.guests"], inputSnapshot: {}, admittedAt: NOW, leaseExpiresAt: "2026-09-15T03:35:00.000Z",
  }})).state;
  const wrong = reduceTaskState(state, toolEvent(state, "t1", { kind: "failure", authority: { kind: "invocation", invocationId: "inv-1", dependencyFingerprint: fp }, failure: {
    failureId: "f1", capabilityId: "hotel.quote", authorityKind: "invocation", authorityId: "inv-1", code: "TIMEOUT", occurredAt: NOW, dependencyFingerprint: fp, dependencyPaths: ["user.stay.guests"],
  }}));
  assert.equal(wrong.rejection, "invalid_tool_authority");
  const good = accept(state, toolEvent(state, "t2", { kind: "failure", authority: { kind: "invocation", invocationId: "inv-1", dependencyFingerprint: fp }, failure: {
    failureId: "f2", capabilityId: "hotel.availability", authorityKind: "invocation", authorityId: "inv-1", code: "TIMEOUT", occurredAt: NOW, dependencyFingerprint: fp, dependencyPaths: ["user.stay.guests"],
  }}));
  assert.equal(good.state.control.pendingToolInvocation.status, "failed");
  assert.equal(good.state.observations.failures.at(-1)?.failureId, "f2");
});

test("lifecycle transition invalidates in-flight work that explicitly depends on active lifecycle", async () => {
  let state = emptyTask();
  state = accept(state, userEvent(state, "u1", { requestedGoal: { op: "set", value: "reservation" }, operationIntent: { op: "set", value: "reserve" } })).state;
  const fp = await dependencyFingerprint({ x: 1 });
  state = accept(state, serverEvent(state, "s1", { kind: "prepared_operation_recorded", operation: {
    operationId: "op-1", operationType: "reserve", operationFingerprint: "op:1", dependencyFingerprint: fp,
    dependencyPaths: ["lifecycle", "user.operationIntent"], inputSnapshot: {}, status: "prepared",
  }})).state;
  const ended = accept(state, serverEvent(state, "s2", { kind: "lifecycle_changed", lifecycle: "abandoned" }));
  assert.equal(ended.state.lifecycle, "abandoned");
  assert.equal(ended.state.control.preparedOperation.status, "invalidated");
});

test("synthetic J01 remains expressible without LLM or provider calls", async () => {
  let { state } = await stateWithGroundedSelection();
  state = accept(state, userEvent(state, "j-u4", { operationIntent: { op: "set", value: "reserve" } })).state;
  const fp = await dependencyFingerprint({ roomId: "room-102", stay: state.user.stay });
  state = accept(state, serverEvent(state, "j-s3", { kind: "prepared_operation_recorded", operation: {
    operationId: "j-op", operationType: "reserve", operationFingerprint: "j-operation", dependencyFingerprint: fp,
    dependencyPaths: ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "user.stay.guests", "control.groundedSelection", "user.operationIntent"], inputSnapshot: { roomId: "room-102", ...state.user.stay }, status: "prepared",
  }})).state;
  state = accept(state, serverEvent(state, "j-s4", { kind: "prepared_operation_status_changed", operationId: "j-op", operationFingerprint: "j-operation", status: "approval_required" })).state;
  state = accept(state, serverEvent(state, "j-s5", { kind: "prepared_operation_status_changed", operationId: "j-op", operationFingerprint: "j-operation", status: "approved" })).state;
  const authority = { kind: "operation", operationId: "j-op", operationFingerprint: "j-operation", dependencyFingerprint: fp };
  state = accept(state, toolEvent(state, "j-t2", { kind: "booking", authority, observation: {
    observationId: "j-booking", status: "CONFIRMED", source: "tool", bookingId: "BK-J01", dependencyFingerprint: fp, dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
  }})).state;
  state = accept(state, toolEvent(state, "j-t3", { kind: "execution_succeeded", authority, operationType: "reserve", observationId: "j-booking" })).state;
  assert.equal(state.user.requestedGoal, "reservation");
  assert.equal(state.user.operationIntent, "reserve");
  assert.equal(state.control.preparedOperation.status, "approved");
  assert.equal(state.observations.booking.bookingId, "BK-J01");
  assert.equal(state.observations.executionResults.at(-1)?.status, "succeeded");
});
