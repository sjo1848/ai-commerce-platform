import test from "node:test";
import assert from "node:assert/strict";
import {
  admitInterpreterOutput,
  buildTrustedInterpreterInput,
  materializeInterpreterArtifacts,
} from "../dist/cognitive/semantic-interpreter.js";

function state() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-i4-hardening",
    taskId: "task-i4-hardening",
    lifecycle: "active",
    stateRevision: 7,
    recentEventIds: [],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 4 },
      preferences: [],
      requestedRoomCount: 2,
      operationIntent: "reserve",
    },
    observations: { executionResults: [], failures: [] },
    control: {
      dialogueAnchor: {
        anchorId: "anchor-hardening",
        kind: "occupancy",
        createdAtStateRevision: 7,
        dependencyPaths: ["user.requestedRoomCount", "user.stay.guests"],
      },
    },
    provenance: {},
  };
}

const temporalContext = {
  trustedNow: "2026-09-15T01:30:00-03:00",
  timezone: "America/Argentina/Mendoza",
  locale: "es-AR",
  temporalPolicyId: "hotel-temporal-v1@1",
};

function input(overrides = {}) {
  return buildTrustedInterpreterInput({
    currentUserMessage: "dos y dos",
    state: state(),
    temporalContext,
    presentedEntities: [
      { kind: "room", label: "Habitación 101" },
      { kind: "room", label: "Habitación 102" },
    ],
    focusedOrdinal: 1,
    ...overrides,
  });
}

const validRaw = () => ({
  classification: "task",
  taskSemanticChanges: {
    requestedOccupancy: {
      op: "set",
      value: { kind: "ordered_distribution", guestsPerRoom: [2, 2] },
    },
  },
});

const serverEnvelope = {
  eventId: "event-hardening",
  sessionId: "session-i4-hardening",
  taskId: "task-i4-hardening",
  expectedStateRevision: 7,
  occurredAt: "2026-09-15T04:45:00.000Z",
};

test("materialization rejects a valid-looking object that never passed admission", () => {
  assert.throws(
    () => materializeInterpreterArtifacts(validRaw(), serverEnvelope),
    /must pass admission/i,
  );
});

test("admitted output is deep-frozen and cannot be changed after admission", () => {
  const admitted = admitInterpreterOutput(validRaw(), input());
  assert.equal(admitted.ok, true);
  assert.equal(Object.isFrozen(admitted.output), true);
  assert.equal(Object.isFrozen(admitted.output.taskSemanticChanges), true);
  assert.equal(Object.isFrozen(admitted.output.taskSemanticChanges.requestedOccupancy), true);
  assert.equal(Object.isFrozen(admitted.output.taskSemanticChanges.requestedOccupancy.value), true);
  assert.equal(Object.isFrozen(admitted.output.taskSemanticChanges.requestedOccupancy.value.guestsPerRoom), true);
  assert.throws(() => admitted.output.taskSemanticChanges.requestedOccupancy.value.guestsPerRoom.push(99));
  const artifacts = materializeInterpreterArtifacts(admitted.output, serverEnvelope);
  assert.deepEqual(
    artifacts.userSemanticEvent.payload.requestedOccupancy.value.guestsPerRoom,
    [2, 2],
  );
});

test("oversized user message is rejected instead of silently truncated", () => {
  assert.throws(
    () => input({ currentUserMessage: "x".repeat(8001) }),
    /1\.\.8000/,
  );
});

test("presentation context above 20 entities is rejected instead of truncated", () => {
  const presentedEntities = Array.from({ length: 21 }, (_, index) => ({
    kind: "room",
    label: `Habitación ${index + 1}`,
  }));
  assert.throws(
    () => input({ presentedEntities, focusedOrdinal: undefined }),
    /exceeds 20 entities/i,
  );
});

test("oversized presentation label is rejected instead of truncated", () => {
  assert.throws(
    () => input({ presentedEntities: [{ kind: "room", label: "x".repeat(121) }], focusedOrdinal: 1 }),
    /1\.\.120/,
  );
});

test("focusedOrdinal must address an actually presented entity", () => {
  assert.throws(
    () => input({ focusedOrdinal: 3 }),
    /must identify a presented entity/i,
  );
});

test("goal and commit intent must be semantically compatible after patches", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      requestedGoal: { op: "set", value: "cancellation" },
      operationIntent: { op: "set", value: "reserve" },
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(raw, input()),
    { ok: false, rejection: "invalid_semantic_combination" },
  );
});

test("commit intent without an effective compatible goal is rejected", () => {
  const noGoal = state();
  delete noGoal.user.requestedGoal;
  delete noGoal.user.operationIntent;
  const projected = buildTrustedInterpreterInput({
    currentUserMessage: "reservala",
    state: noGoal,
    temporalContext,
  });
  const raw = {
    classification: "task",
    taskSemanticChanges: { operationIntent: { op: "set", value: "reserve" } },
  };
  assert.deepEqual(
    admitInterpreterOutput(raw, projected),
    { ok: false, rejection: "invalid_semantic_combination" },
  );
});

test("occupancy cardinality must agree with effective requestedRoomCount", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      requestedOccupancy: {
        op: "set",
        value: { kind: "ordered_distribution", guestsPerRoom: [1, 1, 2] },
      },
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(raw, input()),
    { ok: false, rejection: "invalid_semantic_combination" },
  );
});

test("explicit occupancy assignments also obey effective requestedRoomCount", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      requestedOccupancy: {
        op: "set",
        value: {
          kind: "explicit_assignments",
          assignments: [
            { room: { kind: "ordinal", value: 1 }, guests: 1 },
            { room: { kind: "ordinal", value: 2 }, guests: 1 },
            { room: { kind: "room_number", value: "103" }, guests: 2 },
          ],
        },
      },
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(raw, input()),
    { ok: false, rejection: "invalid_semantic_combination" },
  );
});
