import test from "node:test";
import assert from "node:assert/strict";
import {
  HotelTaskPlanner,
  HOTEL_TASK_DEFINITION_V1,
  applyInterpreterTurnToPlanner,
  applyToolOutcomeToPlanner,
  admitResponseForPublication,
  buildHotelDomainCapabilities,
  buildResponsePublicationCandidate,
  capabilityPreconditionFingerprint,
  commitAcceptedPublication,
  hotelCapabilityDependencyProjection,
  renderOperationalResponse,
} from "../dist/index.js";

function fact(value, revision = 1) {
  return { value, provenance: { source: "user", revision } };
}

const capabilities = buildHotelDomainCapabilities([
  "hms.checkAvailability",
  "hms.getQuote",
  "hms.createReservation",
  "hms.createMultiReservation",
]);

function pendingAvailabilityState() {
  const state = {
    taskId: "task-e2e-read",
    sessionId: "session-e2e-read",
    taskType: "hotel_reservation_domain",
    lifecycle: "active",
    stateRevision: 3,
    recentEventIds: [],
    requestedGoal: fact("reservation"),
    requestedStay: {
      checkIn: fact("2026-10-20"),
      checkOut: fact("2026-10-22"),
      guests: fact(2),
    },
    preferences: [],
    availability: {
      status: "pending",
      dependencyFingerprint: "pending",
      dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "requestedStay.guests"],
      querySnapshot: { checkIn: "2026-10-20", checkOut: "2026-10-22", guests: 2 },
      rooms: [],
    },
    quote: { status: "not_queried", dependencyKeys: [], roomIds: [] },
    groundedSelection: { status: "none", roomIds: [], dependencyKeys: [] },
    bookings: [],
    pendingToolInvocation: {
      invocationId: "inv-e2e-availability",
      capabilityId: "availability",
      status: "pending",
      dependencyFingerprint: "pending",
      dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "requestedStay.guests"],
      inputSnapshot: { checkIn: "2026-10-20", checkOut: "2026-10-22", guests: 2 },
      startedAt: "2026-09-13T17:20:00Z",
    },
    execution: { status: "not_started" },
  };
  const projection = hotelCapabilityDependencyProjection(state, "availability");
  const capability = capabilities.availability;
  assert.ok(projection);
  assert.ok(capability);
  const fingerprint = capabilityPreconditionFingerprint(HOTEL_TASK_DEFINITION_V1, capability, projection);
  state.availability.dependencyFingerprint = fingerprint;
  state.pendingToolInvocation.dependencyFingerprint = fingerprint;
  return state;
}

function executingReservationState() {
  return {
    taskId: "task-e2e-write",
    sessionId: "session-e2e-write",
    taskType: "hotel_reservation_domain",
    lifecycle: "active",
    stateRevision: 9,
    recentEventIds: [],
    requestedGoal: fact("reservation"),
    requestedStay: {
      checkIn: fact("2026-11-01"),
      checkOut: fact("2026-11-03"),
      guests: fact(2),
    },
    preferences: [],
    requestedRoomCount: fact(1),
    operationIntent: {
      kind: "reserve",
      status: "active",
      provenance: { source: "user", revision: 2 },
    },
    availability: {
      status: "observed",
      observationRevision: 7,
      dependencyFingerprint: "dep-av-write",
      dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "requestedStay.guests"],
      querySnapshot: { checkIn: "2026-11-01", checkOut: "2026-11-03", guests: 2 },
      rooms: [{ roomId: "room-secret-write", roomNumber: "303", roomType: "Doble" }],
      guestCapacityCoverage: "not_modeled",
      observedAt: "2026-09-13T17:21:00Z",
    },
    quote: { status: "not_queried", dependencyKeys: [], roomIds: [] },
    groundedSelection: {
      status: "grounded",
      roomIds: ["room-secret-write"],
      basedOnAvailabilityRevision: 7,
      dependencyFingerprint: "ground-write",
      dependencyKeys: ["availability", "operationIntent"],
    },
    bookings: [],
    preparedOperation: {
      operationId: "operation-e2e-write",
      operationType: "reserve",
      capabilityId: "reserve_single",
      toolId: "hms.createReservation",
      operationFingerprint: "operation-fingerprint-e2e",
      dependencyFingerprint: "operation-dependency-e2e",
      dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "requestedRoomCount", "availability", "groundedSelection", "operationIntent"],
      canonicalInputSnapshot: {
        guestId: "trusted-guest-secret",
        roomId: "room-secret-write",
        checkIn: "2026-11-01",
        checkOut: "2026-11-03",
      },
      status: "approved",
    },
    execution: {
      status: "executing",
      operationId: "operation-e2e-write",
      operationFingerprint: "operation-fingerprint-e2e",
      dependencyFingerprint: "operation-dependency-e2e",
    },
  };
}

async function buildAndPublish(state, nextStep, responseId, eventId) {
  const built = await buildResponsePublicationCandidate({ state, nextStep, responseId });
  assert.equal(built.ok, true, built.ok ? undefined : built.failureCode);
  const text = renderOperationalResponse(built.candidate.context);
  const admission = await admitResponseForPublication(built.candidate, state);
  assert.equal(admission.ok, true, admission.ok ? undefined : admission.failureCode);
  const commit = commitAcceptedPublication({
    state,
    admission: admission.admission,
    eventId,
    publishedAt: "2026-09-13T17:25:00Z",
    channelAccepted: true,
  });
  assert.equal(commit.ok, true, commit.ok ? undefined : commit.failureCode);
  return { candidate: built.candidate, text, publishedState: commit.reduction.nextState };
}

test("ACP-3.0.8.6 full read loop maps HMS outcome, replans, renders, publishes and grounds the next ordinal from the published anchor", async () => {
  const initial = pendingAvailabilityState();
  const outcome = applyToolOutcomeToPlanner({
    state: initial,
    envelope: {
      outcome: "success",
      eventId: "tool-outcome-e2e-read",
      observationRevision: 11,
      observedAt: "2026-09-13T17:22:00Z",
      correlation: { kind: "invocation", invocationId: "inv-e2e-availability" },
      result: {
        source: "hms",
        truth: "transactional",
        hotelId: "hotel-secret-id",
        start: "2026-10-20",
        end: "2026-10-22",
        capacityMode: "not_modeled",
        requestedGuests: 2,
        capacityFilterApplied: false,
        traceId: "trace-secret-id",
        rooms: [
          { id: "room-secret-1", roomNumber: "401", roomType: "Doble", status: "available", priceCents: 100000, currency: "ARS" },
          { id: "room-secret-2", roomNumber: "402", roomType: "Suite", status: "available", priceCents: 200000, currency: "ARS" },
        ],
      },
    },
    planner: new HotelTaskPlanner(),
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities,
  });
  assert.equal(outcome.ok, true, outcome.ok ? undefined : outcome.failureCode);
  assert.equal(outcome.nextStep.kind, "ASK");
  assert.equal(outcome.nextStep.field, "selection");

  const published = await buildAndPublish(outcome.nextState, outcome.nextStep, "response-e2e-read", "publish-e2e-read");
  const surface = JSON.stringify(published.candidate.context);
  assert.equal(surface.includes("room-secret-1"), false);
  assert.equal(surface.includes("hotel-secret-id"), false);
  assert.equal(surface.includes("trace-secret-id"), false);
  assert.equal(surface.includes("100000"), false);
  assert.match(published.text, /401/);
  assert.match(published.text, /402/);
  assert.match(published.text, /¿Cuál preferís\?/);
  assert.match(published.text, /no valida la capacidad/i);
  assert.deepEqual(
    published.publishedState.conversationControl.activeDialogueAnchor.presentedEntities.map((item) => item.roomNumber),
    ["401", "402"],
  );

  const nextTurn = applyInterpreterTurnToPlanner({
    state: published.publishedState,
    output: {
      classification: "task",
      taskSemanticChanges: {
        requestedSelectionReference: {
          op: "set",
          value: { kind: "ordinal", ordinal: 2, scope: "observation_scoped" },
        },
      },
    },
    planner: new HotelTaskPlanner(),
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities,
    meta: {
      eventId: "user-select-after-publication",
      sourceRevision: 3,
      dialogueAnchor: published.publishedState.conversationControl.activeDialogueAnchor,
    },
  });
  assert.equal(nextTurn.ok, true, nextTurn.ok ? undefined : nextTurn.failureCode);
  assert.deepEqual(nextTurn.nextState.groundedSelection.roomIds, ["room-secret-2"]);
});

test("ACP-3.0.8.6 full write-outcome loop publishes confirmed booking truth without exposing trusted execution input", async () => {
  const initial = executingReservationState();
  const outcome = applyToolOutcomeToPlanner({
    state: initial,
    envelope: {
      outcome: "success",
      eventId: "tool-outcome-e2e-write",
      observationRevision: 12,
      observedAt: "2026-09-13T17:23:00Z",
      correlation: { kind: "operation", operationId: "operation-e2e-write" },
      result: {
        source: "hms",
        truth: "transactional",
        hotelId: "hotel-write-secret",
        bookingId: "BOOK-9001",
        guestId: "trusted-guest-secret",
        roomId: "room-secret-write",
        start: "2026-11-01",
        end: "2026-11-03",
        status: "confirmed",
        totalCents: 333300,
        currency: "ARS",
        replayed: false,
        traceId: "trace-write-secret",
      },
    },
    planner: new HotelTaskPlanner(),
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities,
  });
  assert.equal(outcome.ok, true, outcome.ok ? undefined : outcome.failureCode);
  assert.equal(outcome.nextStep.kind, "COMPLETE");

  const published = await buildAndPublish(outcome.nextState, outcome.nextStep, "response-e2e-write", "publish-e2e-write");
  assert.equal(published.candidate.context.purpose, "success");
  assert.match(published.text, /confirmada/i);
  assert.match(published.text, /BOOK-9001/);
  const surface = JSON.stringify(published.candidate.context);
  assert.equal(surface.includes("trusted-guest-secret"), false);
  assert.equal(surface.includes("room-secret-write"), false);
  assert.equal(surface.includes("hotel-write-secret"), false);
  assert.equal(surface.includes("trace-write-secret"), false);
  assert.equal(published.publishedState.execution.status, "confirmed");
  assert.equal(published.publishedState.bookings.at(-1).bookingId, "BOOK-9001");
  assert.equal(published.publishedState.conversationControl.activeDialogueAnchor, undefined);
});
