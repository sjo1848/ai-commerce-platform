import test from "node:test";
import assert from "node:assert/strict";
import { reduceTaskState } from "../dist/cognitive/task-state-reducer.js";
import { dependencyFingerprint } from "../dist/cognitive/fingerprint.js";

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

function userEvent(state, eventId, payload) {
  return {
    eventId,
    kind: "user_semantic",
    sessionId: state.sessionId,
    taskId: state.taskId,
    expectedStateRevision: state.stateRevision,
    occurredAt: "2026-09-15T03:30:00.000Z",
    payload,
  };
}

function serverEvent(state, eventId, payload) {
  return {
    eventId,
    kind: "server_control",
    sessionId: state.sessionId,
    taskId: state.taskId,
    expectedStateRevision: state.stateRevision,
    occurredAt: "2026-09-15T03:30:00.000Z",
    payload,
  };
}

function toolEvent(state, eventId, payload) {
  return {
    eventId,
    kind: "tool_observation",
    sessionId: state.sessionId,
    taskId: state.taskId,
    expectedStateRevision: state.stateRevision,
    occurredAt: "2026-09-15T03:30:00.000Z",
    payload,
  };
}

function accept(state, event) {
  const result = reduceTaskState(state, event);
  assert.equal(result.accepted, true, `expected event ${event.eventId} to be accepted: ${result.rejection ?? "unknown"}`);
  assert.equal(result.duplicate, false);
  return result;
}

async function stateWithAvailability() {
  let state = emptyTask();
  state = accept(state, userEvent(state, "u1", {
    requestedGoal: { op: "set", value: "reservation" },
    stay: {
      checkIn: { op: "set", value: "2027-01-15" },
      checkOut: { op: "set", value: "2027-01-17" },
      guests: { op: "set", value: 2 },
    },
  })).state;

  const dependencyPaths = ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"];
  const fp = await dependencyFingerprint({ checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });

  state = accept(state, serverEvent(state, "s1", {
    kind: "invocation_recorded",
    invocation: {
      invocationId: "inv-availability-1",
      capabilityId: "hotel.availability",
      status: "admitted",
      dependencyFingerprint: fp,
      dependencyPaths,
      inputSnapshot: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      admittedAt: "2026-09-15T03:30:00.000Z",
      leaseExpiresAt: "2026-09-15T03:35:00.000Z",
    },
  })).state;

  state = accept(state, toolEvent(state, "t1", {
    kind: "availability",
    authority: { kind: "invocation", invocationId: "inv-availability-1", dependencyFingerprint: fp },
    observation: {
      observationId: "availability-1",
      status: "observed",
      source: "tool",
      query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      rooms: [
        { roomId: "room-101", roomNumber: "101", capacity: 2 },
        { roomId: "room-102", roomNumber: "102", capacity: 2 },
      ],
      dependencyFingerprint: fp,
      dependencyPaths,
    },
  })).state;

  return { state, availabilityFp: fp };
}

async function stateWithGroundedSelection() {
  let { state } = await stateWithAvailability();
  state = accept(state, userEvent(state, "u2", {
    requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 2 } },
  })).state;

  const selectionFp = await dependencyFingerprint({ observationId: "availability-1", ordinal: 2 });
  state = accept(state, serverEvent(state, "s2", {
    kind: "reference_grounded",
    groundedSelection: {
      roomIds: ["room-102"],
      sourceObservationId: "availability-1",
      authority: "server",
      dependencyFingerprint: selectionFp,
      dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
    },
  })).state;

  return { state, selectionFp };
}

test("user semantic transition is scoped, revisioned and duplicate-idempotent", () => {
  const initial = emptyTask();
  const event = userEvent(initial, "u1", {
    requestedGoal: { op: "set", value: "reservation" },
    stay: {
      checkIn: { op: "set", value: "2027-01-15" },
      checkOut: { op: "set", value: "2027-01-17" },
    },
  });
  const first = reduceTaskState(initial, event);
  assert.equal(first.accepted, true);
  assert.equal(first.state.stateRevision, 1);
  assert.deepEqual(first.state.recentEventIds, ["u1"]);

  const duplicate = reduceTaskState(first.state, event);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.material, false);
  assert.equal(duplicate.state.stateRevision, 1);

  const stale = reduceTaskState(first.state, { ...userEvent(first.state, "u2", {}), expectedStateRevision: 0 });
  assert.equal(stale.accepted, false);
  assert.equal(stale.rejection, "stale_state_revision");

  const wrongSession = reduceTaskState(first.state, { ...userEvent(first.state, "u3", {}), sessionId: "other" });
  assert.equal(wrongSession.accepted, false);
  assert.equal(wrongSession.rejection, "wrong_session");
});

test("invalid dates and contradictory occupancy fail closed without partial state mutation", () => {
  const initial = emptyTask();
  const invalidDate = reduceTaskState(initial, userEvent(initial, "u1", {
    stay: { checkIn: { op: "set", value: "2027-02-30" } },
  }));
  assert.equal(invalidDate.accepted, false);
  assert.equal(invalidDate.rejection, "invalid_user_semantics");
  assert.deepEqual(invalidDate.state, initial);

  let state = accept(initial, userEvent(initial, "u2", {
    stay: { guests: { op: "set", value: 4 } },
    requestedRoomCount: { op: "set", value: 2 },
  })).state;
  const contradiction = reduceTaskState(state, userEvent(state, "u3", {
    requestedOccupancy: { op: "set", value: { kind: "ordered_distribution", guestsPerRoom: [1, 2] } },
  }));
  assert.equal(contradiction.accepted, false);
  assert.equal(contradiction.rejection, "invalid_user_semantics");
  assert.equal(contradiction.state.stateRevision, state.stateRevision);
});

test("tool truth cannot be promoted without current invocation authority", async () => {
  const initial = emptyTask();
  const fp = await dependencyFingerprint({ stay: "x" });
  const result = reduceTaskState(initial, toolEvent(initial, "t1", {
    kind: "availability",
    authority: { kind: "invocation", invocationId: "missing", dependencyFingerprint: fp },
    observation: {
      observationId: "availability-1",
      status: "observed",
      source: "tool",
      query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      rooms: [{ roomId: "room-101" }],
      dependencyFingerprint: fp,
      dependencyPaths: ["user.stay.checkIn"],
    },
  }));
  assert.equal(result.accepted, false);
  assert.equal(result.rejection, "invalid_tool_authority");
  assert.equal(result.state.observations.availability, undefined);
});

test("late tool result after relevant correction is rejected and old invocation is superseded", async () => {
  let state = emptyTask();
  state = accept(state, userEvent(state, "u1", {
    stay: {
      checkIn: { op: "set", value: "2027-01-15" },
      checkOut: { op: "set", value: "2027-01-17" },
      guests: { op: "set", value: 2 },
    },
  })).state;
  const fp = await dependencyFingerprint({ checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });
  state = accept(state, serverEvent(state, "s1", {
    kind: "invocation_recorded",
    invocation: {
      invocationId: "inv-1",
      capabilityId: "hotel.availability",
      status: "admitted",
      dependencyFingerprint: fp,
      dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      inputSnapshot: {},
      admittedAt: "2026-09-15T03:30:00.000Z",
      leaseExpiresAt: "2026-09-15T03:35:00.000Z",
    },
  })).state;

  const correction = accept(state, userEvent(state, "u2", {
    stay: {
      checkIn: { op: "set", value: "2027-01-16" },
      checkOut: { op: "set", value: "2027-01-18" },
    },
  }));
  state = correction.state;
  assert.equal(state.control.pendingToolInvocation.status, "superseded");
  assert.ok(correction.invalidations.some((entry) => entry.target === "control.pendingToolInvocation"));

  const late = reduceTaskState(state, toolEvent(state, "t1", {
    kind: "availability",
    authority: { kind: "invocation", invocationId: "inv-1", dependencyFingerprint: fp },
    observation: {
      observationId: "old",
      status: "observed",
      source: "tool",
      query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      rooms: [{ roomId: "room-101" }],
      dependencyFingerprint: fp,
      dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
    },
  }));
  assert.equal(late.accepted, false);
  assert.equal(late.rejection, "invalid_tool_authority");
  assert.equal(late.state.observations.availability, undefined);
});

test("causal invalidation preserves unrelated truth but clears the dependency chain", async () => {
  let { state } = await stateWithGroundedSelection();
  state = accept(state, userEvent(state, "u3", {
    operationIntent: { op: "set", value: "reserve" },
  })).state;

  const operationFp = await dependencyFingerprint({ roomId: "room-102", checkIn: "2027-01-15", checkOut: "2027-01-17" });
  state = accept(state, serverEvent(state, "s3", {
    kind: "prepared_operation_recorded",
    operation: {
      operationId: "op-1",
      operationType: "reserve",
      operationFingerprint: "operation:1",
      dependencyFingerprint: operationFp,
      dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "control.groundedSelection", "user.operationIntent"],
      inputSnapshot: { roomId: "room-102" },
      status: "prepared",
    },
  })).state;

  const preference = accept(state, userEvent(state, "u4", {
    preferences: { op: "set", value: ["piso alto"] },
  }));
  state = preference.state;
  assert.equal(preference.invalidations.length, 0);
  assert.equal(state.observations.availability.observationId, "availability-1");
  assert.deepEqual(state.control.groundedSelection.roomIds, ["room-102"]);
  assert.equal(state.control.preparedOperation.status, "prepared");

  const corrected = accept(state, userEvent(state, "u5", {
    stay: { checkOut: { op: "set", value: "2027-01-18" } },
  }));
  state = corrected.state;
  assert.equal(state.observations.availability, undefined);
  assert.equal(state.control.groundedSelection, undefined);
  assert.equal(state.control.preparedOperation.status, "invalidated");
  assert.ok(corrected.invalidations.some((entry) => entry.target === "observations.availability"));
  assert.ok(corrected.invalidations.some((entry) => entry.target === "control.groundedSelection"));
  assert.ok(corrected.invalidations.some((entry) => entry.target === "control.preparedOperation"));
});

test("reference grounding is server-only and must bind current observation candidates", async () => {
  let { state } = await stateWithAvailability();
  state = accept(state, userEvent(state, "u2", {
    requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 1 } },
  })).state;

  assert.equal(state.control.groundedSelection, undefined, "reducer must not resolve symbolic references from the user event");

  const bad = reduceTaskState(state, serverEvent(state, "s2", {
    kind: "reference_grounded",
    groundedSelection: {
      roomIds: ["room-999"],
      sourceObservationId: "availability-1",
      authority: "server",
      dependencyFingerprint: "selection:bad",
      dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
    },
  }));
  assert.equal(bad.accepted, false);
  assert.equal(bad.rejection, "invalid_server_control");

  const good = accept(state, serverEvent(state, "s3", {
    kind: "reference_grounded",
    groundedSelection: {
      roomIds: ["room-101"],
      sourceObservationId: "availability-1",
      authority: "server",
      dependencyFingerprint: "selection:good",
      dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
    },
  }));
  assert.deepEqual(good.state.control.groundedSelection.roomIds, ["room-101"]);
});

test("approval_required cannot be bypassed by a tool success event", async () => {
  let { state } = await stateWithGroundedSelection();
  state = accept(state, userEvent(state, "u3", { operationIntent: { op: "set", value: "reserve" } })).state;
  const dependencyFingerprintValue = await dependencyFingerprint({ room: "room-102" });
  state = accept(state, serverEvent(state, "s3", {
    kind: "prepared_operation_recorded",
    operation: {
      operationId: "op-1",
      operationType: "reserve",
      operationFingerprint: "operation:1",
      dependencyFingerprint: dependencyFingerprintValue,
      dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
      inputSnapshot: { roomId: "room-102" },
      status: "prepared",
    },
  })).state;
  state = accept(state, serverEvent(state, "s4", {
    kind: "prepared_operation_status_changed",
    operationId: "op-1",
    operationFingerprint: "operation:1",
    status: "approval_required",
  })).state;

  const authority = {
    kind: "operation",
    operationId: "op-1",
    operationFingerprint: "operation:1",
    dependencyFingerprint: dependencyFingerprintValue,
  };
  const bypass = reduceTaskState(state, toolEvent(state, "t2", {
    kind: "booking",
    authority,
    observation: {
      observationId: "booking-1",
      status: "CONFIRMED",
      source: "tool",
      bookingId: "BK-1",
      dependencyFingerprint: dependencyFingerprintValue,
      dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
    },
  }));
  assert.equal(bypass.accepted, false);
  assert.equal(bypass.rejection, "invalid_tool_authority");

  state = accept(state, serverEvent(state, "s5", {
    kind: "prepared_operation_status_changed",
    operationId: "op-1",
    operationFingerprint: "operation:1",
    status: "approved",
  })).state;
  const afterApproval = accept(state, toolEvent(state, "t3", {
    kind: "booking",
    authority,
    observation: {
      observationId: "booking-1",
      status: "CONFIRMED",
      source: "tool",
      bookingId: "BK-1",
      dependencyFingerprint: dependencyFingerprintValue,
      dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
    },
  }));
  assert.equal(afterApproval.state.observations.booking.bookingId, "BK-1");
});

test("synthetic J01 crosses user/tool/server authority without LLM or real tool execution", async () => {
  let state = emptyTask();

  state = accept(state, userEvent(state, "j01-u1", {
    requestedGoal: { op: "set", value: "reservation" },
    stay: {
      checkIn: { op: "set", value: "2027-01-15" },
      checkOut: { op: "set", value: "2027-01-17" },
    },
  })).state;
  state = accept(state, userEvent(state, "j01-u2", {
    stay: { guests: { op: "set", value: 2 } },
  })).state;

  const availabilityFp = await dependencyFingerprint({ checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });
  state = accept(state, serverEvent(state, "j01-s1", {
    kind: "invocation_recorded",
    invocation: {
      invocationId: "j01-inv-availability",
      capabilityId: "hotel.availability",
      status: "admitted",
      dependencyFingerprint: availabilityFp,
      dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      inputSnapshot: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      admittedAt: "2026-09-15T03:30:00.000Z",
      leaseExpiresAt: "2026-09-15T03:35:00.000Z",
    },
  })).state;
  state = accept(state, toolEvent(state, "j01-t1", {
    kind: "availability",
    authority: { kind: "invocation", invocationId: "j01-inv-availability", dependencyFingerprint: availabilityFp },
    observation: {
      observationId: "j01-availability",
      status: "observed",
      source: "tool",
      query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      rooms: [{ roomId: "room-101", roomNumber: "101", capacity: 2 }],
      dependencyFingerprint: availabilityFp,
      dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
    },
  })).state;
  state = accept(state, userEvent(state, "j01-u3", {
    requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 1 } },
  })).state;
  state = accept(state, serverEvent(state, "j01-s2", {
    kind: "reference_grounded",
    groundedSelection: {
      roomIds: ["room-101"],
      sourceObservationId: "j01-availability",
      authority: "server",
      dependencyFingerprint: "j01-selection",
      dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
    },
  })).state;
  state = accept(state, userEvent(state, "j01-u4", {
    operationIntent: { op: "set", value: "reserve" },
  })).state;

  const operationDependencyFp = await dependencyFingerprint({ roomId: "room-101", stay: state.user.stay });
  state = accept(state, serverEvent(state, "j01-s3", {
    kind: "prepared_operation_recorded",
    operation: {
      operationId: "j01-op",
      operationType: "reserve",
      operationFingerprint: "j01-operation",
      dependencyFingerprint: operationDependencyFp,
      dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests", "control.groundedSelection", "user.operationIntent"],
      inputSnapshot: { roomId: "room-101", ...state.user.stay },
      status: "prepared",
    },
  })).state;
  state = accept(state, serverEvent(state, "j01-s4", {
    kind: "prepared_operation_status_changed",
    operationId: "j01-op",
    operationFingerprint: "j01-operation",
    status: "approval_required",
  })).state;
  state = accept(state, serverEvent(state, "j01-s5", {
    kind: "prepared_operation_status_changed",
    operationId: "j01-op",
    operationFingerprint: "j01-operation",
    status: "approved",
  })).state;

  const opAuthority = {
    kind: "operation",
    operationId: "j01-op",
    operationFingerprint: "j01-operation",
    dependencyFingerprint: operationDependencyFp,
  };
  state = accept(state, toolEvent(state, "j01-t2", {
    kind: "booking",
    authority: opAuthority,
    observation: {
      observationId: "j01-booking",
      status: "CONFIRMED",
      source: "tool",
      bookingId: "BK-J01",
      dependencyFingerprint: operationDependencyFp,
      dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
    },
  })).state;
  state = accept(state, toolEvent(state, "j01-t3", {
    kind: "execution_succeeded",
    authority: opAuthority,
    operationType: "reserve",
    observationId: "j01-booking",
  })).state;

  assert.equal(state.stateRevision, 12);
  assert.equal(state.user.requestedGoal, "reservation");
  assert.equal(state.user.operationIntent, "reserve");
  assert.deepEqual(state.control.groundedSelection.roomIds, ["room-101"]);
  assert.equal(state.control.preparedOperation.status, "approved");
  assert.equal(state.observations.booking.bookingId, "BK-J01");
  assert.equal(state.observations.executionResults.at(-1)?.status, "succeeded");
});
