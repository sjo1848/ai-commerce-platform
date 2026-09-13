import test from "node:test";
import assert from "node:assert/strict";
import {
  HotelTaskPlanner,
  HOTEL_TASK_DEFINITION_V1,
  buildHotelDomainCapabilities,
  runJ01ProviderSemanticPreflight,
} from "../dist/index.js";
import { ModelProviderError } from "../dist/core/model-provider.js";
import { DurableExperimentBudgetProvider } from "../dist/core/neuron-budget.js";

function emptyState() {
  return {
    taskId: "task-j01-provider-preflight",
    sessionId: "session-j01-provider-preflight",
    taskType: "hotel_reservation_domain",
    lifecycle: "active",
    stateRevision: 0,
    recentEventIds: [],
    requestedStay: {},
    preferences: [],
    availability: { status: "not_queried", rooms: [], dependencyKeys: [] },
    quote: { status: "not_queried", roomIds: [], dependencyKeys: [] },
    groundedSelection: { status: "none", roomIds: [], dependencyKeys: [] },
    bookings: [],
    execution: { status: "not_started" },
  };
}

const capabilities = buildHotelDomainCapabilities(["hms.checkAvailability", "hms.createReservation"]);
const temporalContext = {
  trustedNow: "2026-09-13T19:00:00-03:00",
  timezone: "America/Argentina/Mendoza",
  locale: "es-AR",
  calendarPolicyId: "gregorian",
  temporalPolicyVersion: "1",
};

function validProviderOutput() {
  return {
    classification: "task",
    taskSemanticChanges: {
      requestedGoal: { op: "set", value: "reservation" },
      checkIn: { op: "set", value: "2027-02-10" },
      checkOut: { op: "set", value: "2027-02-12" },
      guests: { op: "set", value: 2 },
      operationIntent: { op: "set", value: { kind: "reserve", status: "active" } },
    },
  };
}

function budgeted(inner) {
  const counters = { reserve: 0, settle: 0, release: 0 };
  const snapshot = (observedProviderNeurons = 0, inferenceCount = 0, activeReservationCount = 0, totalReservedAllowance = 0) => ({
    experimentId: "acp3-j01-provider-preflight",
    configuredMaxNeurons: 1_000,
    configuredReserve: 0,
    observedProviderNeurons,
    inferenceCount,
    updatedAt: "2026-09-13T19:00:00Z",
    status: "ACTIVE",
    activeReservationCount,
    totalReservedAllowance,
  });
  const store = {
    async reserve() {
      counters.reserve += 1;
      return {
        token: "00000000-0000-4000-8000-000000000001",
        snapshot: snapshot(0, 0, 1, 100),
      };
    },
    async settle(_token, neurons) {
      counters.settle += 1;
      return snapshot(neurons, 1, 0, 0);
    },
    async release() {
      counters.release += 1;
      return snapshot();
    },
  };
  return {
    provider: new DurableExperimentBudgetProvider(inner, store, {
      configuredMaxNeurons: 1_000,
      configuredReserve: 0,
      conservativeNextCallAllowance: 100,
    }),
    counters,
  };
}

function baseInput(provider, state = emptyState(), userMessage = "Quiero reservar una habitación del 10 al 12 de febrero de 2027 para 2 personas.") {
  return {
    state,
    userMessage,
    temporalContext,
    provider,
    planner: new HotelTaskPlanner(),
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities,
    meta: { eventId: "j01-provider-preflight-user", sourceRevision: 1 },
  };
}

test("J01 provider preflight performs one budgeted semantic inference and stops at read-only availability before Core/Executor", async () => {
  let calls = 0;
  let capturedRequest;
  const guarded = budgeted({
    async completeStructured(request) {
      calls += 1;
      capturedRequest = request;
      return {
        value: validProviderOutput(),
        model: "provider/test-model",
        inputTokens: 120,
        outputTokens: 45,
        latencyMs: 33,
        estimatedCostUsd: 0.0002,
        providerNeurons: 80,
      };
    },
  });

  const result = await runJ01ProviderSemanticPreflight(baseInput(guarded.provider));
  assert.equal(result.ok, true, result.ok ? undefined : result.failureCode);
  assert.equal(calls, 1);
  assert.equal(guarded.counters.reserve, 1);
  assert.equal(guarded.counters.settle, 1);
  assert.equal(guarded.counters.release, 0);
  assert.equal(capturedRequest.label, "acp.semantic_interpreter.v1");
  assert.equal(capturedRequest.temperature, 0);
  assert.equal(JSON.stringify(capturedRequest).includes("hms.checkAvailability"), false);
  assert.equal(JSON.stringify(capturedRequest).includes("hms.createReservation"), false);

  assert.equal(result.nextStep.kind, "CALL_TOOL");
  assert.equal(result.nextStep.capabilityId, "availability");
  assert.equal(result.nextStep.effectClass, "read");
  assert.deepEqual(result.nextStep.groundedInput, {
    checkIn: "2027-02-10",
    checkOut: "2027-02-12",
    guests: 2,
  });
  assert.equal(result.nextState.pendingToolInvocation, undefined);
  assert.equal(result.nextState.preparedOperation, undefined);
  assert.equal(result.nextState.execution.status, "not_started");
  assert.equal(result.nextState.operationIntent.kind, "reserve");
  assert.deepEqual(result.receipt, {
    inferenceCount: 1,
    model: "provider/test-model",
    inputTokens: 120,
    outputTokens: 45,
    latencyMs: 33,
    estimatedCostUsd: 0.0002,
    providerNeurons: 80,
  });
});

test("J01 provider preflight rejects an unbudgeted provider before dispatch", async () => {
  let calls = 0;
  const provider = { async completeStructured() { calls += 1; return { value: validProviderOutput(), model: "provider/test-model", providerNeurons: 10 }; } };
  const result = await runJ01ProviderSemanticPreflight(baseInput(provider));
  assert.deepEqual(result, { ok: false, failureCode: "J01_PREFLIGHT_PROVIDER_GUARD_REQUIRED" });
  assert.equal(calls, 0);
});

test("J01 provider preflight rejects dirty operational state before provider or budget dispatch", async () => {
  let calls = 0;
  const guarded = budgeted({ async completeStructured() { calls += 1; return { value: validProviderOutput(), model: "provider/test-model", providerNeurons: 10 }; } });
  const state = emptyState();
  state.execution = {
    status: "executing",
    operationId: "operation-secret",
    operationFingerprint: "fingerprint-secret",
    dependencyFingerprint: "dependency-secret",
  };

  const result = await runJ01ProviderSemanticPreflight(baseInput(guarded.provider, state));
  assert.deepEqual(result, { ok: false, failureCode: "J01_PREFLIGHT_STATE_NOT_CLEAN" });
  assert.equal(calls, 0);
  assert.equal(guarded.counters.reserve, 0);
});

test("J01 provider preflight rejects local invalid input before provider or budget dispatch", async () => {
  let calls = 0;
  const guarded = budgeted({ async completeStructured() { calls += 1; return { value: validProviderOutput(), model: "provider/test-model", providerNeurons: 10 }; } });
  const result = await runJ01ProviderSemanticPreflight(baseInput(guarded.provider, emptyState(), "   "));
  assert.deepEqual(result, { ok: false, failureCode: "J01_PREFLIGHT_INPUT_INVALID" });
  assert.equal(calls, 0);
  assert.equal(guarded.counters.reserve, 0);
});

test("J01 provider preflight rejects invalid semantic output and never falls back to language parsing", async () => {
  let calls = 0;
  const guarded = budgeted({
    async completeStructured() {
      calls += 1;
      return {
        value: {
          classification: "task",
          taskSemanticChanges: { requestedGoal: { op: "set", value: "reservation" } },
          toolId: "hms.createReservation",
        },
        model: "provider/test-model",
        providerNeurons: 25,
      };
    },
  });

  const result = await runJ01ProviderSemanticPreflight(baseInput(guarded.provider));
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "J01_PREFLIGHT_SEMANTIC_VALIDATION_FAILED");
  assert.equal(calls, 1);
  assert.equal(guarded.counters.reserve, 1);
  assert.equal(guarded.counters.settle, 1);
});

test("J01 provider preflight never retries uncertain provider failure and preserves bounded underlying category", async () => {
  let calls = 0;
  const guarded = budgeted({
    async completeStructured() {
      calls += 1;
      throw new ModelProviderError("secret upstream text", "CloudflareError3036");
    },
  });

  const result = await runJ01ProviderSemanticPreflight(baseInput(guarded.provider));
  assert.deepEqual(result, {
    ok: false,
    failureCode: "J01_PREFLIGHT_PROVIDER_FAILURE",
    providerCategory: "EXPERIMENT_BUDGET_PROVIDER_UNCERTAIN",
    underlyingProviderCategory: "CloudflareError3036",
  });
  assert.equal(calls, 1);
  assert.equal(guarded.counters.reserve, 1);
  assert.equal(guarded.counters.settle, 0);
  assert.equal(guarded.counters.release, 0);
  assert.equal(JSON.stringify(result).includes("secret upstream text"), false);
});

test("J01 provider preflight requires provider identity evidence before accepting a settled semantic result", async () => {
  let calls = 0;
  const guarded = budgeted({
    async completeStructured() {
      calls += 1;
      return { value: validProviderOutput(), providerNeurons: 10 };
    },
  });

  const result = await runJ01ProviderSemanticPreflight(baseInput(guarded.provider));
  assert.deepEqual(result, { ok: false, failureCode: "J01_PREFLIGHT_PROVIDER_IDENTITY_MISSING" });
  assert.equal(calls, 1);
  assert.equal(guarded.counters.settle, 1);
});

test("J01 provider preflight fails closed when valid semantics do not lead to the expected availability read", async () => {
  let calls = 0;
  const guarded = budgeted({
    async completeStructured() {
      calls += 1;
      return {
        value: { classification: "social", directives: { interaction: "social" } },
        model: "provider/test-model",
        providerNeurons: 10,
      };
    },
  });

  const result = await runJ01ProviderSemanticPreflight(baseInput(guarded.provider));
  assert.deepEqual(result, { ok: false, failureCode: "J01_PREFLIGHT_UNEXPECTED_NEXT_STEP" });
  assert.equal(calls, 1);
  assert.equal(guarded.counters.settle, 1);
});
