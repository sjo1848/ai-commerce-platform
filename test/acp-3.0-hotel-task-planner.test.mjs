import test from "node:test";
import assert from "node:assert/strict";
import { planHotelTask } from "../dist/cognitive/hotel-task-planner.js";
import {
  HOTEL_TASK_DEFINITION_V1,
  hotelDomainCapabilities,
} from "../dist/cognitive/hotel-task-definition.js";

const trigger = (overrides = {}) => ({ origin: "user", acceptedEventId: "event-1", ...overrides });
const clone = (value) => structuredClone(value);

function emptyState() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-planner",
    taskId: "task-planner",
    lifecycle: "active",
    stateRevision: 1,
    recentEventIds: [],
    user: { stay: {}, preferences: [] },
    observations: { executionResults: [], failures: [] },
    control: {},
    provenance: {},
  };
}

function reservationReadyFacts() {
  const state = emptyState();
  state.user.requestedGoal = "reservation";
  state.user.stay = { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 };
  return state;
}

function availabilityObservation(rooms = [
  { roomId: "room-101", roomNumber: "101", capacity: 2 },
  { roomId: "room-102", roomNumber: "102", capacity: 2 },
]) {
  return {
    observationId: "availability-1",
    status: "observed",
    source: "tool",
    query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    rooms,
    dependencyFingerprint: "availability:1",
    dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  };
}

function groundSelection(state, roomIds = ["room-102"]) {
  state.user.requestedSelectionReference = roomIds.length === 1 ? { kind: "ordinal", value: 2 } : { kind: "ordinal_set", values: roomIds.map((_, i) => i + 1) };
  state.control.groundedSelection = {
    roomIds,
    sourceObservationId: "availability-1",
    authority: "server",
    dependencyFingerprint: `selection:${roomIds.join(",")}`,
    dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
  };
  return state;
}

function context(state, options = {}) {
  return {
    state,
    trigger: options.trigger ?? trigger(),
    taskDefinition: options.taskDefinition ?? HOTEL_TASK_DEFINITION_V1,
    capabilities: options.capabilities ?? hotelDomainCapabilities(),
  };
}

test("domain capability view matches the six real HMS agent contracts", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(HOTEL_TASK_DEFINITION_V1.bindings).map(([key, value]) => [key, value.capabilityId])),
    {
      availability: "hms.checkAvailability",
      quote: "hms.getQuote",
      reserve_single: "hms.createReservation",
      reserve_multi: "hms.createMultiReservation",
      cancel_single: "hms.cancelReservation",
      cancel_multi: "hms.cancelMultiReservation",
    },
  );
  assert.equal("modify" in HOTEL_TASK_DEFINITION_V1.bindings, false);
  assert.equal("booking_lookup" in HOTEL_TASK_DEFINITION_V1.bindings, false);
});

test("J01 synthetic planner progression reaches approval wait then completion", async () => {
  let state = reservationReadyFacts();
  delete state.user.stay.guests;
  let step = await planHotelTask(context(state));
  assert.equal(step.kind, "ASK");
  assert.equal(step.field, "guests");

  state.user.stay.guests = 2;
  step = await planHotelTask(context(state));
  assert.equal(step.kind, "CALL_TOOL");
  assert.equal(step.capabilityId, "hms.checkAvailability");

  state.observations.availability = availabilityObservation();
  step = await planHotelTask(context(state));
  assert.equal(step.kind, "ASK");
  assert.equal(step.field, "selection");
  assert.equal(step.presentationContext.rooms.length, 2);

  groundSelection(state);
  step = await planHotelTask(context(state));
  assert.deepEqual(step, { kind: "RESPOND", responseIntent: "reservation_ready_for_commit", groundedReferences: ["availability-1"] });

  state.user.operationIntent = "reserve";
  step = await planHotelTask(context(state));
  assert.equal(step.kind, "CALL_TOOL");
  assert.equal(step.capabilityId, "hms.createReservation");
  assert.deepEqual(step.groundedInput, { roomId: "room-102", checkIn: "2027-01-15", checkOut: "2027-01-17" });
  assert.equal("guestId" in step.groundedInput, false);

  state.control.preparedOperation = {
    operationId: "op-1",
    operationType: "reserve",
    operationFingerprint: "op:1",
    dependencyFingerprint: step.preconditionFingerprint,
    dependencyPaths: ["lifecycle", "control.groundedSelection", "user.operationIntent"],
    inputSnapshot: step.groundedInput,
    status: "approval_required",
  };
  step = await planHotelTask(context(state, { trigger: trigger({ origin: "server", acceptedEventId: "approval-required" }) }));
  assert.deepEqual(step, { kind: "WAIT", reason: "approval_pending", correlationId: "op-1" });

  state.observations.booking = {
    observationId: "booking-1",
    status: "CONFIRMED",
    source: "tool",
    bookingId: "BK-1",
    dependencyFingerprint: "booking:1",
    dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
  };
  state.observations.executionResults.push({ operationId: "op-1", operationType: "reserve", status: "succeeded", observationId: "booking-1" });
  step = await planHotelTask(context(state, { trigger: trigger({ origin: "tool", acceptedEventId: "booking-created" }) }));
  assert.equal(step.kind, "COMPLETE");
  assert.equal(step.completionReason, "reservation_confirmed");
});

test("all reservation stay facts in one turn skip fixed interview and acquire availability", async () => {
  const step = await planHotelTask(context(reservationReadyFacts()));
  assert.equal(step.kind, "CALL_TOOL");
  assert.equal(step.capabilityId, "hms.checkAvailability");
  assert.deepEqual(step.groundedInput, { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });
});

test("current availability is reused and empty availability never triggers another read", async () => {
  const state = reservationReadyFacts();
  state.observations.availability = availabilityObservation([]);
  const step = await planHotelTask(context(state));
  assert.deepEqual(step, { kind: "RESPOND", responseIntent: "no_availability", groundedReferences: ["availability-1"] });
});

test("matching pending read waits; superseded pending allows a newly fingerprinted call", async () => {
  const state = reservationReadyFacts();
  const first = await planHotelTask(context(state));
  assert.equal(first.kind, "CALL_TOOL");
  state.control.pendingToolInvocation = {
    invocationId: "inv-1",
    capabilityId: "hms.checkAvailability",
    status: "admitted",
    dependencyFingerprint: first.preconditionFingerprint,
    dependencyPaths: ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
    inputSnapshot: first.groundedInput,
    admittedAt: "2026-09-15T04:00:00.000Z",
    leaseExpiresAt: "2026-09-15T04:05:00.000Z",
  };
  const waiting = await planHotelTask(context(state));
  assert.deepEqual(waiting, { kind: "WAIT", reason: "tool_pending", correlationId: "inv-1" });
  state.control.pendingToolInvocation.status = "superseded";
  state.user.stay.checkOut = "2027-01-18";
  const replanned = await planHotelTask(context(state));
  assert.equal(replanned.kind, "CALL_TOOL");
  assert.notEqual(replanned.preconditionFingerprint, first.preconditionFingerprint);
});

test("room selection is never inferred by Planner from availability candidates", async () => {
  const state = reservationReadyFacts();
  state.observations.availability = availabilityObservation();
  state.user.requestedSelectionReference = { kind: "ordinal", value: 1 };
  const step = await planHotelTask(context(state));
  assert.equal(step.kind, "ASK");
  assert.equal(step.reason, "selection_reference_not_grounded");
  assert.equal(step.dialogueAnchorSpec.referencedObservationId, "availability-1");
});

test("multi-room reservation uses native HMS capability and never invents an occupancy requirement", async () => {
  const state = reservationReadyFacts();
  state.user.requestedRoomCount = 2;
  state.observations.availability = availabilityObservation();
  groundSelection(state, ["room-101", "room-102"]);
  state.user.operationIntent = "reserve";
  const step = await planHotelTask(context(state));
  assert.equal(step.kind, "CALL_TOOL");
  assert.equal(step.capabilityId, "hms.createMultiReservation");
  assert.deepEqual(step.groundedInput, { roomIds: ["room-101", "room-102"], checkIn: "2027-01-15", checkOut: "2027-01-17" });
});

test("multi-room reservation degrades instead of splitting writes when native capability is unavailable", async () => {
  const state = reservationReadyFacts();
  state.user.requestedRoomCount = 2;
  state.observations.availability = availabilityObservation();
  groundSelection(state, ["room-101", "room-102"]);
  state.user.operationIntent = "reserve";
  const capabilities = hotelDomainCapabilities(["availability", "quote", "reserve_single", "cancel_single", "cancel_multi"]);
  const step = await planHotelTask(context(state, { capabilities }));
  assert.equal(step.kind, "DEGRADE");
  assert.equal(step.reasonCode, "capability_unavailable:reserve_multi");
});

test("approval pending does not block a newer explicit quote read", async () => {
  const state = reservationReadyFacts();
  state.observations.availability = availabilityObservation();
  groundSelection(state);
  state.user.operationIntent = "reserve";
  state.control.preparedOperation = {
    operationId: "op-1",
    operationType: "reserve",
    operationFingerprint: "op:1",
    dependencyFingerprint: "opdep:1",
    dependencyPaths: ["lifecycle", "control.groundedSelection", "user.operationIntent"],
    inputSnapshot: {},
    status: "approval_required",
  };
  const step = await planHotelTask(context(state, { trigger: trigger({ readDirective: { kind: "quote" } }) }));
  assert.equal(step.kind, "CALL_TOOL");
  assert.equal(step.capabilityId, "hms.getQuote");
});

test("approval pending with no newer action waits and does not replan the mutation", async () => {
  const state = reservationReadyFacts();
  state.observations.availability = availabilityObservation();
  groundSelection(state);
  state.user.operationIntent = "reserve";
  state.control.preparedOperation = {
    operationId: "op-1",
    operationType: "reserve",
    operationFingerprint: "op:1",
    dependencyFingerprint: "opdep:1",
    dependencyPaths: ["lifecycle", "control.groundedSelection", "user.operationIntent"],
    inputSnapshot: {},
    status: "approval_required",
  };
  const step = await planHotelTask(context(state));
  assert.deepEqual(step, { kind: "WAIT", reason: "approval_pending", correlationId: "op-1" });
});

test("cancellation asks for a reference first, then fails honestly if no booking lookup capability exists", async () => {
  const state = emptyState();
  state.user.requestedGoal = "cancellation";
  let step = await planHotelTask(context(state));
  assert.equal(step.kind, "ASK");
  assert.equal(step.field, "bookingReference");
  state.user.bookingReference = { kind: "visible_reference", value: "BK-123" };
  step = await planHotelTask(context(state));
  assert.equal(step.kind, "DEGRADE");
  assert.equal(step.reasonCode, "booking_lookup_unavailable");
});

test("grounded cancellation emits exact hms.cancelReservation write only after explicit cancel commit", async () => {
  const state = emptyState();
  state.user.requestedGoal = "cancellation";
  state.user.bookingReference = { kind: "visible_reference", value: "BK-123" };
  state.observations.booking = {
    observationId: "booking-current",
    status: "CONFIRMED",
    source: "tool",
    bookingId: "BK-123",
    dependencyFingerprint: "booking-current:1",
    dependencyPaths: ["user.bookingReference"],
  };
  state.control.groundedBookingTarget = {
    bookingId: "BK-123",
    sourceObservationId: "booking-current",
    authority: "server",
    dependencyFingerprint: "booking-target:1",
    dependencyPaths: ["observations.booking", "user.bookingReference"],
  };
  let step = await planHotelTask(context(state));
  assert.equal(step.kind, "RESPOND");
  assert.equal(step.responseIntent, "cancellation_ready_for_commit");
  state.user.operationIntent = "cancel";
  step = await planHotelTask(context(state));
  assert.equal(step.kind, "CALL_TOOL");
  assert.equal(step.capabilityId, "hms.cancelReservation");
  assert.deepEqual(step.groundedInput, { bookingId: "BK-123" });
});

test("modification is unsupported rather than synthesized as cancel plus create", async () => {
  const state = emptyState();
  state.user.requestedGoal = "modification";
  const step = await planHotelTask(context(state));
  assert.equal(step.kind, "DEGRADE");
  assert.equal(step.reasonCode, "modification_capability_unavailable");
});

test("retry is bounded to current state and write retries stay in Core recovery", async () => {
  const state = reservationReadyFacts();
  state.observations.failures.push({
    failureId: "failure-1",
    capabilityId: "hms.checkAvailability",
    authorityKind: "invocation",
    authorityId: "inv-old",
    code: "TIMEOUT",
    occurredAt: "2026-09-15T04:00:00.000Z",
    dependencyFingerprint: "old",
    dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  });
  let step = await planHotelTask(context(state, { trigger: trigger({ retryDirective: {} }) }));
  assert.equal(step.kind, "CALL_TOOL");
  assert.equal(step.capabilityId, "hms.checkAvailability");
  state.observations.failures.push({
    failureId: "failure-2",
    capabilityId: "hms.createReservation",
    authorityKind: "operation",
    authorityId: "op-old",
    code: "OUTCOME_UNKNOWN",
    occurredAt: "2026-09-15T04:01:00.000Z",
    dependencyFingerprint: "old-write",
    dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
  });
  step = await planHotelTask(context(state, { trigger: trigger({ retryDirective: { targetOperation: "hms.createReservation" } }) }));
  assert.equal(step.kind, "DEGRADE");
  assert.equal(step.reasonCode, "write_retry_requires_core_recovery");
});

test("social/acknowledgement trigger can be handled while business work is pending", async () => {
  const state = reservationReadyFacts();
  const initial = await planHotelTask(context(state));
  state.control.pendingToolInvocation = {
    invocationId: "inv-1",
    capabilityId: "hms.checkAvailability",
    status: "admitted",
    dependencyFingerprint: initial.preconditionFingerprint,
    dependencyPaths: ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
    inputSnapshot: initial.groundedInput,
    admittedAt: "2026-09-15T04:00:00.000Z",
    leaseExpiresAt: "2026-09-15T04:05:00.000Z",
  };
  const step = await planHotelTask(context(state, { trigger: trigger({ interactionDirective: "social" }) }));
  assert.deepEqual(step, { kind: "RESPOND", responseIntent: "interaction_social", groundedReferences: [] });
});

test("same State + Trigger + Definition + Capabilities produces the same NextStep", async () => {
  const state = reservationReadyFacts();
  const ctx = context(state);
  const first = await planHotelTask(ctx);
  const second = await planHotelTask(clone(ctx));
  assert.deepEqual(second, first);
  assert.match(first.preconditionFingerprint, /^fp1:sha256:[0-9a-f]{64}$/);
});

test("tampered semantic capability view fails closed and never routes a tool", async () => {
  const state = reservationReadyFacts();
  const capabilities = hotelDomainCapabilities();
  capabilities.enabled.availability = { ...capabilities.enabled.availability, capabilityId: "evil.tool" };
  const step = await planHotelTask(context(state, { capabilities }));
  assert.equal(step.kind, "DEGRADE");
  assert.equal(step.reasonCode, "capability_contract_mismatch");
});
