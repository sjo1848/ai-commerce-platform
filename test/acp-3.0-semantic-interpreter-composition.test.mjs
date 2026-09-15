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
    sessionId: "session-compose",
    taskId: "task-compose",
    lifecycle: "active",
    stateRevision: 2,
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

function input(message = "gracias, reservála") {
  return buildTrustedInterpreterInput({
    currentUserMessage: message,
    state: state(),
    temporalContext: {
      trustedNow: "2026-09-15T18:27:00-03:00",
      timezone: "America/Argentina/Mendoza",
      locale: "es-AR",
      temporalPolicyId: "hotel-temporal-v1@1",
    },
  });
}

const envelope = {
  eventId: "evt-compose",
  sessionId: "session-compose",
  taskId: "task-compose",
  expectedStateRevision: 2,
  occurredAt: "2026-09-15T21:27:00.000Z",
};

test("task chatter cannot mask a durable commit", () => {
  const admitted = admitInterpreterOutput({
    classification: "task",
    taskSemanticChanges: {
      operationIntent: { op: "set", value: "reserve" },
    },
    directives: { interaction: "acknowledge" },
  }, input());
  assert.equal(admitted.ok, true);
  const artifacts = materializeInterpreterArtifacts(admitted.output, envelope);
  assert.equal(artifacts.userSemanticEvent.payload.operationIntent.value, "reserve");
  assert.equal(artifacts.planningTrigger.interactionDirective, undefined);
});

test("task chatter cannot mask a business read directive", () => {
  const admitted = admitInterpreterOutput({
    classification: "task",
    directives: {
      readRequest: { kind: "quote", target: "current_selection" },
      interaction: "acknowledge",
    },
  }, input("gracias, ¿cuánto sale?"));
  assert.equal(admitted.ok, true);
  const artifacts = materializeInterpreterArtifacts(admitted.output, envelope);
  assert.deepEqual(artifacts.planningTrigger.readDirective, { kind: "quote", target: "current_selection" });
  assert.equal(artifacts.planningTrigger.interactionDirective, undefined);
});

test("task classification with only conversational chatter is rejected", () => {
  assert.deepEqual(
    admitInterpreterOutput({
      classification: "task",
      directives: { interaction: "acknowledge" },
    }, input("gracias")),
    { ok: false, rejection: "invalid_semantic_combination" },
  );
});

test("pure social classification still produces a social short-circuit", () => {
  const admitted = admitInterpreterOutput({ classification: "social" }, input("gracias"));
  assert.equal(admitted.ok, true);
  const artifacts = materializeInterpreterArtifacts(admitted.output, envelope);
  assert.equal(artifacts.userSemanticEvent, undefined);
  assert.equal(artifacts.planningTrigger.interactionDirective, "social");
});
