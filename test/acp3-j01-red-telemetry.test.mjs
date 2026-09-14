import test from "node:test";
import assert from "node:assert/strict";
import { handleAcp3J01ProviderPreflightRequest } from "../dist/acp3-j01-validation-route.js";
import { DurableExperimentBudgetProvider } from "../dist/core/neuron-budget.js";

function budgetedInvalidSemanticProvider() {
  const snapshot = (observedProviderNeurons = 0, inferenceCount = 0, activeReservationCount = 0, totalReservedAllowance = 0) => ({
    experimentId: "acp3-j01-red-telemetry-test",
    configuredMaxNeurons: 1_000,
    configuredReserve: 0,
    observedProviderNeurons,
    inferenceCount,
    updatedAt: "2026-09-14T01:00:00Z",
    status: "ACTIVE",
    activeReservationCount,
    totalReservedAllowance,
  });
  return new DurableExperimentBudgetProvider({
    async completeStructured() {
      return {
        value: {
          classification: "task",
          taskSemanticChanges: { requestedGoal: { op: "set", value: "reservation" } },
          toolId: "hms.createReservation",
          secretRawField: "must-not-survive",
        },
        model: "provider/telemetry-test",
        inputTokens: 111,
        outputTokens: 22,
        providerNeurons: 46.5,
      };
    },
  }, {
    async reserve() {
      return {
        token: "00000000-0000-4000-8000-000000000099",
        snapshot: snapshot(0, 0, 1, 100),
      };
    },
    async settle(_token, neurons) {
      return snapshot(neurons, 1, 0, 0);
    },
    async release() {
      return snapshot();
    },
  }, {
    configuredMaxNeurons: 1_000,
    configuredReserve: 0,
    conservativeNextCallAllowance: 100,
  });
}

test("J01 semantic RED emits only bounded recoverable telemetry after the consumed provider result", async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    const response = await handleAcp3J01ProviderPreflightRequest(
      new Request("https://validation.invalid/__validation/acp3/j01-provider-preflight", { method: "POST" }),
      budgetedInvalidSemanticProvider(),
      "2026-09-14T01:00:00Z",
    );
    assert.equal(response.status, 422);
  } finally {
    console.log = original;
  }

  const eventLine = lines.find((line) => line.includes('"event":"acp3_j01_provider_preflight_result"'));
  assert.ok(eventLine);
  const event = JSON.parse(eventLine);
  assert.equal(event.outcome, "RED");
  assert.equal(event.httpStatus, 422);
  assert.equal(event.failureCode, "J01_PREFLIGHT_SEMANTIC_VALIDATION_FAILED");
  assert.equal(event.validationMessage, "Interpreter output shape is invalid");
  assert.deepEqual(event.receipt, {
    inferenceCount: 1,
    model: "provider/telemetry-test",
    inputTokens: 111,
    outputTokens: 22,
    providerNeurons: 46.5,
  });

  const serialized = JSON.stringify(event);
  for (const forbidden of ["toolId", "hms.createReservation", "secretRawField", "must-not-survive", "roomId", "bookingId", "guestId", "operationFingerprint"]) {
    assert.equal(serialized.includes(forbidden), false, `telemetry leaked ${forbidden}`);
  }
});
