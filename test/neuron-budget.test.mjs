import assert from "node:assert/strict";
import test from "node:test";
import { DurableExperimentBudgetProvider, ValidationNeuronBudgetProvider, experimentBudgetSnapshot, parseExperimentBudgetSnapshot, parseStoredExperimentBudget, reconcileExperimentBudgetStatus } from "../dist/core/neuron-budget.js";

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
      if (!this.state) this.state = { experimentId: this.experimentId, configuredMaxNeurons: config.configuredMaxNeurons, configuredReserve: config.configuredReserve, conservativeNextCallAllowance: config.conservativeNextCallAllowance, observedProviderNeurons: 0, inferenceCount: 0, updatedAt: "offline", status: "ACTIVE", reservations: new Map() };
      assert.deepEqual([this.state.configuredMaxNeurons, this.state.configuredReserve], [config.configuredMaxNeurons, config.configuredReserve]);
      const reserved = [...this.state.reservations.values()].filter((item) => item.state === "reserved").reduce((sum, item) => sum + item.allowance, 0);
      if (this.state.status === "COMPLETE" || this.state.observedProviderNeurons + reserved + config.conservativeNextCallAllowance > config.configuredMaxNeurons - config.configuredReserve) { this.reconcileStatus(); return null; }
      const token = `server-${++this.sequence}`;
      this.state.reservations.set(token, { allowance: config.conservativeNextCallAllowance, state: "reserved" });
      this.reconcileStatus();
      return { token, snapshot: this.snapshot() };
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
    this.reconcileStatus();
    return this.snapshot();
  }
  reconcileStatus() {
    this.state.status = reconcileExperimentBudgetStatus({
      ...this.state,
      conservativeNextCallAllowance: this.state.conservativeNextCallAllowance,
      reservations: Object.fromEntries(this.state.reservations),
    });
  }
  snapshot() {
    const { reservations, conservativeNextCallAllowance: _allowance, ...snapshot } = this.state;
    const active = [...reservations.values()].filter((item) => item.state === "reserved");
    return { ...snapshot, activeReservationCount: active.length, totalReservedAllowance: active.reduce((sum, item) => sum + item.allowance, 0) };
  }
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
  assert.deepEqual(ledger.snapshot(), { experimentId: "exp-a", configuredMaxNeurons: 10, configuredReserve: 1, observedProviderNeurons: 4, inferenceCount: 1, updatedAt: "offline", status: "BUDGET_EXHAUSTED", activeReservationCount: 0, totalReservedAllowance: 0 });
  await assert.rejects(first.completeStructured(request), (error) => error?.causeName === "NEURON_BUDGET_EXCEEDED");
});

test("durable-ledger snapshots report whether another conservative admission fits after settlement and release", async () => {
  const ledger = new FakeSerializedExperimentLedger("exp-admission-status");
  const config = { configuredMaxNeurons: 20, configuredReserve: 1, conservativeNextCallAllowance: 6 };
  const first = await ledger.reserve(config);
  const second = await ledger.reserve(config);
  assert.equal(first.snapshot.status, "ACTIVE");
  assert.equal(second.snapshot.status, "ACTIVE");

  const settled = await ledger.settle(first.token, 8);
  assert.equal(settled.status, "BUDGET_EXHAUSTED", "8 observed + 6 reserved + 6 next allowance exceeds the 19-neuron allowance");
  assert.equal((await ledger.reserve(config)), null, "the status agrees with the next admission decision");

  const released = await ledger.release(second.token);
  assert.equal(released.status, "ACTIVE", "8 observed + no reservation + 6 next allowance fits the allowance");
  const reservedAgain = await ledger.reserve(config);
  assert.equal(reservedAgain.snapshot.status, "BUDGET_EXHAUSTED", "the newly held reservation makes a further admission unavailable");

  ledger.state.status = "COMPLETE";
  assert.equal((await ledger.release(reservedAgain.token)).status, "COMPLETE", "an explicit terminal status remains terminal");
});

test("successful provider results without provider usage retain their reservation and fail closed", async () => {
  const a = new FakeSerializedExperimentLedger("exp-a");
  const noUsage = { async completeStructured() { return { value: {} }; } };
  await assert.rejects(
    new DurableExperimentBudgetProvider(noUsage, a, experimentConfig).completeStructured({ ...request, sessionAffinity: "unrelated-session" }),
    (error) => error?.causeName === "EXPERIMENT_BUDGET_SETTLEMENT_UNCERTAIN" ,
  );
  assert.equal(a.snapshot().observedProviderNeurons, 0);
  assert.equal(a.snapshot().inferenceCount, 0);
  assert.equal(a.snapshot().activeReservationCount, 1);
  assert.equal(a.snapshot().totalReservedAllowance, 6);
});

test("durable experiment ledgers isolate experiments from sessions", async () => {
  const a = new FakeSerializedExperimentLedger("exp-a");
  const b = new FakeSerializedExperimentLedger("exp-b");
  await new DurableExperimentBudgetProvider({ async completeStructured() { return { value: {}, providerNeurons: 5 }; } }, b, experimentConfig).completeStructured(request);
  assert.equal(a.state, undefined);
  assert.equal(b.snapshot().observedProviderNeurons, 5);
});

test("experiment budget public snapshots round-trip without private reservation state and reject malformed state", () => {
  const stored = JSON.stringify({ experimentId: "exp-snapshot", configuredMaxNeurons: 10, configuredReserve: 1, observedProviderNeurons: 3, inferenceCount: 1, updatedAt: "2026-09-07T00:00:00.000Z", status: "ACTIVE", conservativeNextCallAllowance: 6, reservations: { "00000000-0000-4000-8000-000000000001": { allowance: 6, state: "settled" } } });
  const snapshot = experimentBudgetSnapshot(parseStoredExperimentBudget(stored));
  assert.deepEqual(parseExperimentBudgetSnapshot(JSON.stringify(snapshot)), snapshot);
  assert.deepEqual(Object.keys(snapshot).sort(), ["activeReservationCount", "configuredMaxNeurons", "configuredReserve", "experimentId", "inferenceCount", "observedProviderNeurons", "status", "totalReservedAllowance", "updatedAt"]);
  assert.equal(JSON.stringify(snapshot).includes("reservation"), false);
  assert.throws(() => parseExperimentBudgetSnapshot(JSON.stringify({ ...snapshot, reservations: {} })), /Invalid experiment budget snapshot/);
  assert.throws(() => parseExperimentBudgetSnapshot(JSON.stringify({ ...snapshot, inferenceCount: -1 })), /Invalid experiment budget snapshot/);
  assert.throws(() => parseStoredExperimentBudget(JSON.stringify({ ...JSON.parse(stored), reservations: { "00000000-0000-0000-0000-000000000001": { allowance: 6, state: "reserved" } } })), /Invalid stored experiment budget/);
  assert.throws(() => parseStoredExperimentBudget(JSON.stringify({ ...JSON.parse(stored), reservations: { "00000000-0000-4000-8000-000000000001": { allowance: 5, state: "reserved" } } })), /Invalid stored experiment budget/);
  assert.throws(() => parseStoredExperimentBudget(JSON.stringify({ ...JSON.parse(stored), reservations: { "00000000-0000-4000-8000-000000000001": { allowance: 6, state: "reserved", extra: true } } })), /Invalid stored experiment budget/);
  assert.throws(() => parseStoredExperimentBudget(JSON.stringify(snapshot)), /Invalid stored experiment budget/);
});

test("durable experiment reservation tokens settle and release idempotently and provider failures release their allowance", async () => {
  const ledger = new FakeSerializedExperimentLedger("exp-token");
  const reservation = await ledger.reserve(experimentConfig);
  assert.match(reservation.token, /^server-\d+$/, "the ledger, not the caller, creates the token");
  await ledger.settle(reservation.token, 3);
  await ledger.settle(reservation.token, 3);
  assert.equal(ledger.snapshot().observedProviderNeurons, 3, "replayed settlement cannot double count");
  const releaseReservation = await ledger.reserve(experimentConfig);
  await ledger.release(releaseReservation.token);
  await ledger.release(releaseReservation.token);
  assert.equal(ledger.state.reservations.get(releaseReservation.token).state, "released");
  await assert.rejects(new DurableExperimentBudgetProvider({ async completeStructured() { throw new Error("offline failure"); } }, ledger, experimentConfig).completeStructured(request));
  const failedReservation = [...ledger.state.reservations.values()].find((item) => item.state === "released");
  assert.ok(failedReservation, "a call with no result releases its conservative allowance");
  assert.equal(ledger.snapshot().observedProviderNeurons, 3);
});

test("provider and release failures surface uncertain cause, return no result, and retain reservation", async () => {
  const ledger = new FakeSerializedExperimentLedger("exp-release-uncertain");
  ledger.release = async () => { throw new Error("durable transport unavailable"); };
  const provider = new DurableExperimentBudgetProvider({ async completeStructured() { throw new Error("provider unavailable"); } }, ledger, experimentConfig);
  const outcome = await Promise.allSettled([provider.completeStructured(request)]);
  assert.equal(outcome[0].status, "rejected");
  assert.equal(outcome[0].reason?.causeName, "EXPERIMENT_BUDGET_RELEASE_UNCERTAIN");
  assert.equal(outcome[0].value, undefined, "failure must not return a successful result");
  assert.equal([...ledger.state.reservations.values()].filter((item) => item.state === "reserved").length, 1, "uncertain release retains the reservation");
});

test("settlement failure remains uncertain, retains the reservation, and emits no successful result", async () => {
  const ledger = new FakeSerializedExperimentLedger("exp-settlement");
  const telemetry = [];
  ledger.settle = async () => { throw new Error("durable transport unavailable"); };
  const provider = new DurableExperimentBudgetProvider({ async completeStructured() { return { value: { accepted: true }, providerNeurons: 4 }; } }, ledger, experimentConfig, (snapshot) => telemetry.push(snapshot));
  await assert.rejects(provider.completeStructured(request), (error) => error?.causeName === "EXPERIMENT_BUDGET_SETTLEMENT_UNCERTAIN");
  assert.equal([...ledger.state.reservations.values()].filter((item) => item.state === "reserved").length, 1, "uncertain settlement retains its conservative reservation");
  assert.equal(telemetry.length, 1, "reserve remains observable even when settlement is uncertain");
  assert.equal(telemetry[0].activeReservationCount, 1);
});

test("durable provider emits token-free reconciliation telemetry after reserve, settlement, and provider-failure release", async () => {
  const ledger = new FakeSerializedExperimentLedger("exp-telemetry");
  const telemetry = [];
  const telemetryConfig = { configuredMaxNeurons: 20, configuredReserve: 1, conservativeNextCallAllowance: 6 };
  const provider = new DurableExperimentBudgetProvider({ async completeStructured() { return { value: {}, providerNeurons: 4 }; } }, ledger, telemetryConfig, (snapshot) => telemetry.push(snapshot));
  await provider.completeStructured(request);
  await assert.rejects(new DurableExperimentBudgetProvider({ async completeStructured() { throw new Error("offline failure"); } }, ledger, telemetryConfig, (snapshot) => telemetry.push(snapshot)).completeStructured(request));
  assert.equal(telemetry.length, 4);
  assert.deepEqual(telemetry[1], ledger.snapshot());
  assert.deepEqual(telemetry[0].activeReservationCount, 1);
  assert.deepEqual(telemetry[0].totalReservedAllowance, 6);
  assert.deepEqual(telemetry[1].activeReservationCount, 0);
  assert.deepEqual(telemetry[2].activeReservationCount, 1);
  assert.deepEqual(telemetry[3].activeReservationCount, 0);
  assert.equal(JSON.stringify(telemetry).includes("server-"), false);
});
