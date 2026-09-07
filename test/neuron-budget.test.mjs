import assert from "node:assert/strict";
import test from "node:test";
import { DurableExperimentBudgetProvider, ValidationNeuronBudgetProvider } from "../dist/core/neuron-budget.js";

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

class FakeSerializedExperimentLedger {
  constructor(experimentId) {
    this.experimentId = experimentId;
    this.queue = Promise.resolve();
    this.state = undefined;
    this.sequence = 0;
  }
  serialized(action) {
    const result = this.queue.then(action, action);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  reserve(config) {
    return this.serialized(() => {
      if (!this.state) this.state = { experimentId: this.experimentId, configuredMaxNeurons: config.configuredMaxNeurons, configuredReserve: config.configuredReserve, observedProviderNeurons: 0, inferenceCount: 0, updatedAt: "offline", status: "ACTIVE", reservations: new Map() };
      assert.deepEqual([this.state.configuredMaxNeurons, this.state.configuredReserve], [config.configuredMaxNeurons, config.configuredReserve]);
      const reserved = [...this.state.reservations.values()].filter((item) => item.state === "reserved").reduce((sum, item) => sum + item.allowance, 0);
      if (this.state.observedProviderNeurons + reserved + config.conservativeNextCallAllowance > config.configuredMaxNeurons - config.configuredReserve) { this.state.status = "BUDGET_EXHAUSTED"; return null; }
      const token = `server-${++this.sequence}`;
      this.state.reservations.set(token, { allowance: config.conservativeNextCallAllowance, state: "reserved" });
      return { token };
    });
  }
  settle(token, providerNeurons) { return this.serialized(() => this.transition(token, "settled", providerNeurons)); }
  release(token) { return this.serialized(() => this.transition(token, "released")); }
  transition(token, state, providerNeurons) {
    const reservation = this.state.reservations.get(token);
    assert.ok(reservation, "server-generated reservation token is required");
    if (reservation.state === "reserved") {
      reservation.state = state;
      if (state === "settled") { this.state.inferenceCount += 1; if (providerNeurons !== undefined) this.state.observedProviderNeurons += providerNeurons; }
    }
    return this.snapshot();
  }
  snapshot() { const { reservations, ...snapshot } = this.state; return snapshot; }
}

const experimentConfig = { configuredMaxNeurons: 10, configuredReserve: 1, conservativeNextCallAllowance: 6 };
test("durable experiment ledger serializes concurrent isolate admission and settles only valid provider usage", async () => {
  const ledger = new FakeSerializedExperimentLedger("exp-a");
  let calls = 0;
  const upstream = { async completeStructured() { calls += 1; return { value: {}, providerNeurons: 4 }; } };
  const first = new DurableExperimentBudgetProvider(upstream, ledger, experimentConfig);
  const second = new DurableExperimentBudgetProvider(upstream, ledger, experimentConfig);
  const outcomes = await Promise.allSettled([first.completeStructured(request), second.completeStructured(request)]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1, "one serialized reservation prevents concurrent overspend");
  assert.equal(outcomes.find((result) => result.status === "rejected")?.reason.causeName, "NEURON_BUDGET_EXCEEDED");
  assert.equal(calls, 1);
  assert.deepEqual(ledger.snapshot(), { experimentId: "exp-a", configuredMaxNeurons: 10, configuredReserve: 1, observedProviderNeurons: 4, inferenceCount: 1, updatedAt: "offline", status: "BUDGET_EXHAUSTED" });
  await assert.rejects(first.completeStructured(request), (error) => error?.causeName === "NEURON_BUDGET_EXCEEDED");
});

test("durable experiment ledger releases unknown usage without inventing consumption and isolates experiments from sessions", async () => {
  const a = new FakeSerializedExperimentLedger("exp-a");
  const b = new FakeSerializedExperimentLedger("exp-b");
  const noUsage = { async completeStructured() { return { value: {} }; } };
  await new DurableExperimentBudgetProvider(noUsage, a, experimentConfig).completeStructured({ ...request, sessionAffinity: "unrelated-session" });
  assert.equal(a.snapshot().observedProviderNeurons, 0);
  assert.equal(a.snapshot().inferenceCount, 1);
  await new DurableExperimentBudgetProvider({ async completeStructured() { return { value: {}, providerNeurons: 5 }; } }, b, experimentConfig).completeStructured(request);
  assert.equal(a.snapshot().observedProviderNeurons, 0);
  assert.equal(b.snapshot().observedProviderNeurons, 5);
});

test("durable experiment reservation tokens settle idempotently and provider failures release their allowance", async () => {
  const ledger = new FakeSerializedExperimentLedger("exp-token");
  const reservation = await ledger.reserve(experimentConfig);
  assert.match(reservation.token, /^server-\d+$/, "the ledger, not the caller, creates the token");
  await ledger.settle(reservation.token, 3);
  await ledger.settle(reservation.token, 3);
  assert.equal(ledger.snapshot().observedProviderNeurons, 3, "replayed settlement cannot double count");
  await assert.rejects(new DurableExperimentBudgetProvider({ async completeStructured() { throw new Error("offline failure"); } }, ledger, experimentConfig).completeStructured(request));
  const failedReservation = [...ledger.state.reservations.values()].find((item) => item.state === "released");
  assert.ok(failedReservation, "a call with no result releases its conservative allowance");
  assert.equal(ledger.snapshot().observedProviderNeurons, 3);
});
