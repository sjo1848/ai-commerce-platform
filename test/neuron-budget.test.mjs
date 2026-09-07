import assert from "node:assert/strict";
import test from "node:test";
import { ValidationNeuronBudgetProvider } from "../dist/core/neuron-budget.js";

const request = { messages: [{ role: "user", content: "local fixture" }], schema: { type: "object" } };

test("validation neuron guard admits conservatively and opens only before a subsequent call", async () => {
  let calls = 0;
  const provider = new ValidationNeuronBudgetProvider({ async completeStructured() { calls += 1; return { value: {}, providerNeurons: 8 }; } }, {
    maxNeuronsPerRun: 10, configuredAvailableBudget: 100, configuredReserve: 5, conservativeExpectedCost: 3, observedLocalDayNeurons: 20,
  });
  await provider.completeStructured(request);
  assert.deepEqual(provider.snapshot(), { observedRunNeurons: 8, observedLocalDayNeurons: 28, configuredAvailableBudget: 100, configuredReserve: 5 });
  await assert.rejects(provider.completeStructured(request), (error) => error?.causeName === "NEURON_BUDGET_EXCEEDED");
  assert.equal(calls, 1, "the already-sent call is never cancelled or duplicated");
});

test("validation neuron guard counts only provider-reported neurons and leaves ordinary local providers usable", async () => {
  const provider = new ValidationNeuronBudgetProvider({ async completeStructured() { return { value: {} }; } }, {
    maxNeuronsPerRun: 1, configuredAvailableBudget: 1, configuredReserve: 0, conservativeExpectedCost: 0,
  });
  await provider.completeStructured(request);
  await provider.completeStructured(request);
  assert.equal(provider.snapshot().observedRunNeurons, 0);
});
