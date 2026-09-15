import test from "node:test";
import assert from "node:assert/strict";
import {
  admitInterpreterOutput,
  buildTrustedInterpreterInput,
  materializeInterpreterArtifacts,
} from "../dist/cognitive/semantic-interpreter.js";

function state({ failures = [], stay, goal = "reservation", intent } = {}) {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-cross",
    taskId: "task-cross",
    lifecycle: "active",
    stateRevision: 5,
    recentEventIds: [],
    user: {
      ...(goal !== undefined ? { requestedGoal: goal } : {}),
      stay: stay ?? { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      preferences: [],
      ...(intent !== undefined ? { operationIntent: intent } : {}),
    },
    observations: { executionResults: [], failures },
    control: {},
    provenance: {},
  };
}

const temporalContext = {
  trustedNow: "2026-09-15T01:30:00-03:00",
  timezone: "America/Argentina/Mendoza",
  locale: "es-AR",
  temporalPolicyId: "hotel-temporal-v1@1",
};

function projected(customState = state(), retryableTargets = []) {
  return buildTrustedInterpreterInput({
    currentUserMessage: "probá de nuevo",
    state: customState,
    temporalContext,
    retryableTargets,
  });
}

const envelope = {
  eventId: "cross-event",
  sessionId: "session-cross",
  taskId: "task-cross",
  expectedStateRevision: 5,
  occurredAt: "2026-09-15T04:55:00.000Z",
};

function failure(id) {
  return {
    failureId: `failure-${id}`,
    capabilityId: "hms.checkAvailability",
    authorityKind: "invocation",
    authorityId: `inv-${id}`,
    code: "TIMEOUT",
    occurredAt: "2026-09-15T04:00:00.000Z",
    dependencyFingerprint: `fp-${id}`,
    dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  };
}

test("targetless retry requires exactly one server-projected retryable semantic target", () => {
  const raw = { classification: "task", directives: { retry: {} } };
  assert.deepEqual(
    admitInterpreterOutput(raw, projected(state({ failures: [failure("historical")] }), [])),
    { ok: false, rejection: "invalid_semantic_combination" },
  );

  const admitted = admitInterpreterOutput(
    raw,
    projected(state({ failures: [failure("old-a"), failure("old-b")] }), ["availability"]),
  );
  assert.equal(admitted.ok, true);
  const artifacts = materializeInterpreterArtifacts(admitted.output, envelope);
  assert.deepEqual(artifacts.planningTrigger.retryDirective, { targetOperation: "availability" });

  assert.deepEqual(
    admitInterpreterOutput(raw, projected(state(), ["availability", "quote"])),
    { ok: false, rejection: "invalid_semantic_combination" },
  );
});

test("retryable target projection is bounded unique trusted context", () => {
  assert.throws(
    () => projected(state(), ["availability", "availability"]),
    /bounded unique semantic target set/,
  );
  assert.throws(
    () => projected(state(), ["availability", "quote", "reservation", "cancellation", "modification", "availability"]),
    /bounded unique semantic target set/,
  );
});

test("explicit semantic retry target remains valid without failure-history inference", () => {
  const raw = {
    classification: "task",
    directives: { retry: { targetOperation: "reservation" } },
  };
  const admitted = admitInterpreterOutput(raw, projected(state({ failures: [] })));
  assert.equal(admitted.ok, true);
  const artifacts = materializeInterpreterArtifacts(admitted.output, envelope);
  assert.deepEqual(artifacts.planningTrigger.retryDirective, { targetOperation: "reserve" });
});

test("unknown semantic classification can be admitted for diagnosis but cannot become Planner artifacts", () => {
  const admitted = admitInterpreterOutput({ classification: "unknown" }, projected());
  assert.equal(admitted.ok, true);
  assert.throws(
    () => materializeInterpreterArtifacts(admitted.output, envelope),
    /cannot become a Planner trigger/i,
  );
});

test("effective stay must remain an increasing date range", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      stay: { checkIn: { op: "set", value: "2027-01-18" } },
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(raw, projected()),
    { ok: false, rejection: "invalid_semantic_combination" },
  );
});

test("new checkOut is validated against retained checkIn", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      stay: { checkOut: { op: "set", value: "2027-01-14" } },
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(raw, projected()),
    { ok: false, rejection: "invalid_semantic_combination" },
  );
});

test("temporal provenance cannot be empty bookkeeping", () => {
  const raw = {
    classification: "task",
    directives: { readRequest: { kind: "availability" } },
    temporalResolutionProvenance: {
      expressionClass: "relative",
      trustedNow: temporalContext.trustedNow,
      timezone: temporalContext.timezone,
      policyId: temporalContext.temporalPolicyId,
      normalized: {},
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(raw, projected()),
    { ok: false, rejection: "invalid_output_schema" },
  );
});