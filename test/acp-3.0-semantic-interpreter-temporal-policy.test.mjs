import test from "node:test";
import assert from "node:assert/strict";
import {
  SemanticInterpreterAdapter,
  SEMANTIC_INTERPRETER_TEMPORAL_POLICY_V1,
} from "../dist/cognitive/semantic-interpreter-adapter.js";
import {
  admitInterpreterOutput,
  buildTrustedInterpreterInput,
} from "../dist/cognitive/semantic-interpreter.js";

function state() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-temporal",
    taskId: "task-temporal",
    lifecycle: "active",
    stateRevision: 1,
    recentEventIds: [],
    user: { stay: {}, preferences: [] },
    observations: { executionResults: [], failures: [] },
    control: {},
    provenance: {},
  };
}

function temporalContext(overrides = {}) {
  return {
    trustedNow: "2026-12-20T12:00:00-03:00",
    timezone: "America/Argentina/Mendoza",
    locale: "es-AR",
    temporalPolicyId: "hotel-temporal-v1@1",
    ...overrides,
  };
}

function projected(overrides = {}) {
  return buildTrustedInterpreterInput({
    currentUserMessage: "del 28 de diciembre al 2 de enero",
    state: state(),
    temporalContext: temporalContext(),
    ...overrides,
  });
}

function fakeProvider(handler) {
  const calls = [];
  return {
    calls,
    async completeStructured(request) {
      calls.push(request);
      return handler(request);
    },
  };
}

const server = {
  eventId: "temporal-event",
  sessionId: "session-temporal",
  taskId: "task-temporal",
  expectedStateRevision: 1,
  occurredAt: "2026-09-15T05:00:00.000Z",
};

test("trusted projection is frozen and owns a copied booking window", () => {
  const sourceWindow = { minDate: "2026-12-20", maxDate: "2027-12-20" };
  const input = projected({ temporalContext: temporalContext({ bookingWindow: sourceWindow }) });
  assert.equal(Object.isFrozen(input), true);
  assert.equal(Object.isFrozen(input.temporalContext), true);
  assert.equal(Object.isFrozen(input.temporalContext.bookingWindow), true);
  assert.notEqual(input.temporalContext.bookingWindow, sourceWindow);
  sourceWindow.maxDate = "2028-01-01";
  assert.equal(input.temporalContext.bookingWindow.maxDate, "2027-12-20");
});

test("invalid trusted booking window fails before provider-facing interpretation", () => {
  assert.throws(
    () => projected({ temporalContext: temporalContext({ bookingWindow: { minDate: "2027-01-10", maxDate: "2027-01-01" } }) }),
    /bookingWindow is invalid/i,
  );
});

test("booking window constrains normalized semantic dates", () => {
  const input = projected({
    temporalContext: temporalContext({ bookingWindow: { minDate: "2026-12-20", maxDate: "2027-01-31" } }),
  });
  const outside = {
    classification: "task",
    taskSemanticChanges: {
      stay: {
        checkIn: { op: "set", value: "2027-02-01" },
        checkOut: { op: "set", value: "2027-02-03" },
      },
    },
    temporalResolutionProvenance: {
      expressionClass: "yearless_range",
      trustedNow: input.temporalContext.trustedNow,
      timezone: input.temporalContext.timezone,
      policyId: input.temporalContext.temporalPolicyId,
      normalized: { checkIn: "2027-02-01", checkOut: "2027-02-03" },
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(outside, input),
    { ok: false, rejection: "invalid_semantic_combination" },
  );
});

test("date normalization without provenance is rejected", () => {
  const input = projected();
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      stay: {
        checkIn: { op: "set", value: "2026-12-28" },
        checkOut: { op: "set", value: "2027-01-02" },
      },
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(raw, input),
    { ok: false, rejection: "invalid_temporal_provenance" },
  );
});

test("temporal provenance must cover every date set by the same output", () => {
  const input = projected();
  const partial = {
    classification: "task",
    taskSemanticChanges: {
      stay: {
        checkIn: { op: "set", value: "2026-12-28" },
        checkOut: { op: "set", value: "2027-01-02" },
      },
    },
    temporalResolutionProvenance: {
      expressionClass: "yearless_range",
      trustedNow: input.temporalContext.trustedNow,
      timezone: input.temporalContext.timezone,
      policyId: input.temporalContext.temporalPolicyId,
      normalized: { checkIn: "2026-12-28" },
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(partial, input),
    { ok: false, rejection: "invalid_temporal_provenance" },
  );
});

test("temporal provenance cannot claim a date that the semantic patch did not set", () => {
  const input = projected();
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      stay: { checkIn: { op: "set", value: "2026-12-28" } },
    },
    temporalResolutionProvenance: {
      expressionClass: "day_month",
      trustedNow: input.temporalContext.trustedNow,
      timezone: input.temporalContext.timezone,
      policyId: input.temporalContext.temporalPolicyId,
      normalized: { checkIn: "2026-12-28", checkOut: "2027-01-02" },
    },
  };
  assert.deepEqual(
    admitInterpreterOutput(raw, input),
    { ok: false, rejection: "invalid_temporal_provenance" },
  );
});

test("provider request carries authoritative temporal policy rules as data", async () => {
  const provider = fakeProvider((request) => {
    const payload = JSON.parse(request.messages[1].content);
    assert.deepEqual(payload.temporalPolicy, SEMANTIC_INTERPRETER_TEMPORAL_POLICY_V1);
    assert.equal(payload.temporalPolicy.rangeResolution, "resolve_range_as_one_unit");
    assert.equal(payload.temporalPolicy.explicitYearHandling, "preserve_explicit_year_never_silently_move");
    assert.equal(payload.temporalPolicy.dayOnlyWithoutTrustedMonth, "ambiguous");
    return {
      value: {
        classification: "task",
        taskSemanticChanges: {
          stay: {
            checkIn: { op: "set", value: "2026-12-28" },
            checkOut: { op: "set", value: "2027-01-02" },
          },
        },
        temporalResolutionProvenance: {
          expressionClass: "yearless_range",
          trustedNow: "2026-12-20T12:00:00-03:00",
          timezone: "America/Argentina/Mendoza",
          policyId: "hotel-temporal-v1@1",
          normalized: { checkIn: "2026-12-28", checkOut: "2027-01-02" },
        },
      },
    };
  });
  const adapter = new SemanticInterpreterAdapter(provider);
  const result = await adapter.interpret(projected(), server);
  assert.equal(result.kind, "accepted");
});

test("unknown temporal policy id degrades before calling the provider", async () => {
  const provider = fakeProvider(() => ({ value: { classification: "social" } }));
  const adapter = new SemanticInterpreterAdapter(provider);
  const input = projected({ temporalContext: temporalContext({ temporalPolicyId: "unknown-policy@9" }) });
  const result = await adapter.interpret(input, server);
  assert.deepEqual(result, { kind: "degraded", reason: "trusted_context_invalid" });
  assert.equal(provider.calls.length, 0);
});
