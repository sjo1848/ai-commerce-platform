import test from "node:test";
import assert from "node:assert/strict";
import { planHotelTask } from "../dist/cognitive/hotel-task-planner.js";
import {
  HOTEL_TASK_DEFINITION_V1,
  hotelDomainCapabilities,
} from "../dist/cognitive/hotel-task-definition.js";

const trigger = (overrides = {}) => ({ origin: "user", acceptedEventId: "event-adv", ...overrides });

function baseState() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-adv",
    taskId: "task-adv",
    lifecycle: "active",
    stateRevision: 1,
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

function availability() {
  return {
    observationId: "availability-adv",
    status: "observed",
    source: "tool",
    query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    rooms: [{ roomId: "room-101", roomNumber: "101", capacity: 2 }],
    dependencyFingerprint: "availability:adv",
    dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  };
}

function groundRoom(state) {
  state.observations.availability = availability();
  state.user.requestedSelectionReference = { kind: "ordinal", value: 1 };
  state.control.groundedSelection = {
    roomIds: ["room-101"],
    sourceObservationId: "availability-adv",
    authority: "server",
    dependencyFingerprint: "selection:adv",
    dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
  };
}

function context(state, overrides = {}) {
  return {
    state,
    trigger: overrides.trigger ?? trigger(),
    taskDefinition: overrides.taskDefinition ?? HOTEL_TASK_DEFINITION_V1,
    capabilities: overrides.capabilities ?? hotelDomainCapabilities(),
  };
}

test("completion requires execution success linked to the current booking observation", async () => {
  const state = baseState();
  groundRoom(state);
  state.user.operationIntent = "reserve";
  state.observations.booking = {
    observationId: "booking-current",
    status: "CONFIRMED",
    source: "tool",
    bookingId: "BK-CURRENT",
    dependencyFingerprint: "booking:current",
    dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
  };
  state.observations.executionResults.push({
    operationId: "op-old",
    operationType: "reserve",
    status: "succeeded",
    observationId: "booking-old",
  });

  const notComplete = await planHotelTask(context(state));
  assert.equal(notComplete.kind, "CALL_TOOL");
  assert.equal(notComplete.capabilityId, "hms.createReservation");

  state.observations.executionResults.push({
    operationId: "op-current",
    operationType: "reserve",
    status: "succeeded",
    observationId: "booking-current",
  });
  const complete = await planHotelTask(context(state));
  assert.equal(complete.kind, "COMPLETE");
  assert.equal(complete.completionReason, "reservation_confirmed");
});

test("retry fallback is ambiguous across multiple retained failures even when capabilityId is the same", async () => {
  const state = baseState();
  state.observations.failures.push(
    {
      failureId: "failure-a",
      capabilityId: "hms.checkAvailability",
      authorityKind: "invocation",
      authorityId: "inv-a",
      code: "TIMEOUT",
      occurredAt: "2026-09-15T04:00:00.000Z",
      dependencyFingerprint: "old-a",
      dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
    },
    {
      failureId: "failure-b",
      capabilityId: "hms.checkAvailability",
      authorityKind: "invocation",
      authorityId: "inv-b",
      code: "TIMEOUT",
      occurredAt: "2026-09-15T04:01:00.000Z",
      dependencyFingerprint: "old-b",
      dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
    },
  );

  const ambiguous = await planHotelTask(context(state, { trigger: trigger({ retryDirective: {} }) }));
  assert.equal(ambiguous.kind, "ASK");
  assert.equal(ambiguous.reason, "retry_target_ambiguous");

  const correlated = await planHotelTask(context(state, {
    trigger: trigger({ retryDirective: { correlationId: "inv-b" } }),
  }));
  assert.equal(correlated.kind, "CALL_TOOL");
  assert.equal(correlated.capabilityId, "hms.checkAvailability");
});

test("explicit read directive is not swallowed by interaction or abort presentation directives", async () => {
  const state = baseState();
  groundRoom(state);
  const step = await planHotelTask(context(state, {
    trigger: trigger({
      readDirective: { kind: "quote" },
      abortDirective: true,
      interactionDirective: "acknowledge",
    }),
  }));
  assert.equal(step.kind, "CALL_TOOL");
  assert.equal(step.capabilityId, "hms.getQuote");
});

test("a self-consistently tampered TaskDefinition and capability view cannot reuse the canonical contract identity", async () => {
  const state = baseState();
  const taskDefinition = structuredClone(HOTEL_TASK_DEFINITION_V1);
  taskDefinition.bindings.availability.capabilityId = "evil.tool";
  taskDefinition.bindings.availability.contractIdentity = "evil.tool@hms-agent-v1";
  const capabilities = hotelDomainCapabilities(["availability"], taskDefinition);

  const step = await planHotelTask(context(state, { taskDefinition, capabilities }));
  assert.deepEqual(step, {
    kind: "DEGRADE",
    reasonCode: "planner_contract_mismatch",
    recoverable: false,
    responseIntent: "technical_degradation",
  });
});
