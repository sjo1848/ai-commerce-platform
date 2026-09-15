import test from "node:test";
import assert from "node:assert/strict";
import {
  admitInterpreterOutput,
  buildTrustedInterpreterInput,
  materializeInterpreterArtifacts,
} from "../dist/cognitive/semantic-interpreter.js";
import { SemanticInterpreterAdapter } from "../dist/cognitive/semantic-interpreter-adapter.js";

function state() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-bind",
    taskId: "task-bind",
    lifecycle: "active",
    stateRevision: 7,
    recentEventIds: [],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      preferences: [],
    },
    observations: { executionResults: [], failures: [] },
    control: {},
    provenance: {},
  };
}

function input() {
  return buildTrustedInterpreterInput({
    currentUserMessage: "reservame una habitación",
    state: state(),
    temporalContext: {
      trustedNow: "2026-09-15T18:27:00-03:00",
      timezone: "America/Argentina/Mendoza",
      locale: "es-AR",
      temporalPolicyId: "hotel-temporal-v1@1",
    },
  });
}

function admitted() {
  const projected = input();
  const result = admitInterpreterOutput({
    classification: "task",
    taskSemanticChanges: {
      requestedGoal: { op: "set", value: "reservation" },
      operationIntent: { op: "set", value: "reserve" },
    },
  }, projected);
  assert.equal(result.ok, true);
  return { projected, output: result.output };
}

const correctEnvelope = {
  eventId: "evt-bind-1",
  sessionId: "session-bind",
  taskId: "task-bind",
  expectedStateRevision: 7,
  occurredAt: "2026-09-15T21:27:00.000Z",
};

test("admission requires the exact trusted projection object produced by the server builder", () => {
  const projected = input();
  const forgedClone = structuredClone(projected);
  assert.throws(
    () => admitInterpreterOutput({ classification: "unknown" }, forgedClone),
    /must be built by buildTrustedInterpreterInput/,
  );
});

test("materialization accepts the exact originating session task and state revision", () => {
  const { output } = admitted();
  const artifacts = materializeInterpreterArtifacts(output, correctEnvelope);
  assert.equal(artifacts.userSemanticEvent.sessionId, "session-bind");
  assert.equal(artifacts.userSemanticEvent.taskId, "task-bind");
  assert.equal(artifacts.userSemanticEvent.expectedStateRevision, 7);
});

test("materialization rejects cross-session binding", () => {
  const { output } = admitted();
  assert.throws(
    () => materializeInterpreterArtifacts(output, { ...correctEnvelope, sessionId: "session-other" }),
    /does not match originating TaskState/,
  );
});

test("materialization rejects cross-task binding", () => {
  const { output } = admitted();
  assert.throws(
    () => materializeInterpreterArtifacts(output, { ...correctEnvelope, taskId: "task-other" }),
    /does not match originating TaskState/,
  );
});

test("materialization rejects stale or future state revision binding", () => {
  const { output } = admitted();
  for (const revision of [6, 8]) {
    assert.throws(
      () => materializeInterpreterArtifacts(output, { ...correctEnvelope, expectedStateRevision: revision }),
      /does not match originating TaskState/,
    );
  }
});

test("a structurally identical cloned admitted output cannot bypass admission identity", () => {
  const { output } = admitted();
  const clone = structuredClone(output);
  assert.throws(
    () => materializeInterpreterArtifacts(clone, correctEnvelope),
    /must pass admission before materialization/,
  );
});

test("provider adapter cannot cross-bind a valid interpretation to another task", async () => {
  const provider = {
    async completeStructured() {
      return {
        value: {
          classification: "task",
          taskSemanticChanges: {
            requestedGoal: { op: "set", value: "reservation" },
            operationIntent: { op: "set", value: "reserve" },
          },
        },
      };
    },
  };
  const adapter = new SemanticInterpreterAdapter(provider);
  await assert.rejects(
    adapter.interpret(input(), { ...correctEnvelope, taskId: "task-other" }),
    /does not match originating TaskState/,
  );
});
