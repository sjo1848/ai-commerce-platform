import test from "node:test";
import assert from "node:assert/strict";
import {
  HotelTaskPlanner,
  HOTEL_TASK_DEFINITION_V1,
  applyInterpreterTurnToPlanner,
  admitResponseForPublication,
  buildHotelDomainCapabilities,
  buildResponsePublicationCandidate,
  commitAcceptedPublication,
  renderOperationalResponse,
} from "../dist/index.js";

function fact(value, revision = 1) {
  return { value, provenance: { source: "user", revision } };
}

function baseState() {
  return {
    taskId: "task-response-1",
    sessionId: "session-response-1",
    taskType: "hotel_reservation_domain",
    lifecycle: "active",
    stateRevision: 10,
    recentEventIds: [],
    requestedGoal: fact("availability"),
    requestedStay: {
      checkIn: fact("2026-10-10"),
      checkOut: fact("2026-10-12"),
      guests: fact(2),
    },
    preferences: [],
    availability: {
      status: "observed",
      observationRevision: 4,
      dependencyFingerprint: "availability-dep-4",
      dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "requestedStay.guests"],
      querySnapshot: { checkIn: "2026-10-10", checkOut: "2026-10-12", guests: 2 },
      rooms: [
        { roomId: "room-internal-1", roomNumber: "101", roomType: "Doble" },
        { roomId: "room-internal-2", roomNumber: "202", roomType: "Suite" },
      ],
      guestCapacityCoverage: "not_modeled",
      observedAt: "2026-09-13T17:00:00Z",
    },
    quote: { status: "not_queried", dependencyKeys: [], roomIds: [] },
    groundedSelection: { status: "none", roomIds: [], dependencyKeys: [] },
    bookings: [],
    execution: { status: "not_started" },
  };
}

function availabilityStep() {
  return {
    kind: "RESPOND",
    responseIntent: "availability_result",
    groundedReferences: [{ kind: "availability", observationRevision: 4, roomIds: ["room-internal-1", "room-internal-2"] }],
  };
}

function selectionAskStep() {
  return {
    kind: "ASK",
    field: "selection",
    reason: "show_options_requested",
    presentationContext: {
      kind: "availability_options",
      observationRevision: 4,
      roomIds: ["room-internal-1", "room-internal-2"],
    },
    dialogueAnchorSpec: {
      kind: "selection",
      candidateRoomIds: ["room-internal-1", "room-internal-2"],
      referencedObservationRevision: 4,
    },
  };
}

async function build(state, step, responseId = "response-1") {
  const result = await buildResponsePublicationCandidate({ state, nextStep: step, responseId });
  assert.equal(result.ok, true, result.ok ? undefined : result.failureCode);
  return result.candidate;
}

test("ACP-3 response context exposes semantic options but no internal room ids or raw HMS fields", async () => {
  const candidate = await build(baseState(), availabilityStep());
  assert.equal(candidate.context.purpose, "present_options");
  assert.deepEqual(candidate.context.presentationEntities, [
    { entityType: "room", ordinal: 1, roomNumber: "101", label: "Doble" },
    { entityType: "room", ordinal: 2, roomNumber: "202", label: "Suite" },
  ]);
  const surface = JSON.stringify(candidate.context);
  assert.equal(surface.includes("room-internal-1"), false);
  assert.equal(surface.includes("room-internal-2"), false);
  assert.match(candidate.context.responseDependencyFingerprint, /^resp:v1:[0-9a-f]{64}$/);
  assert.equal(surface.includes("traceId"), false);
  assert.equal(surface.includes("hotelId"), false);
});

test("capacity not modeled is an explicit grounded limitation instead of a capacity claim", async () => {
  const candidate = await build(baseState(), availabilityStep());
  const limitation = candidate.context.groundedFacts.find((item) => item.factId === "guest_capacity_limitation");
  assert.ok(limitation);
  assert.match(limitation.displayValue, /no valida la capacidad/i);
  const rendered = renderOperationalResponse(candidate.context);
  assert.match(rendered, /no valida la capacidad/i);
});

test("question authority stays with Planner and renderer cannot invent a reservation prompt", async () => {
  const candidate = await build(baseState(), selectionAskStep());
  assert.deepEqual(candidate.context.questionSpec, { field: "selection", reason: "show_options_requested" });
  const rendered = renderOperationalResponse(candidate.context);
  assert.match(rendered, /¿Cuál preferís\?/);
  assert.doesNotMatch(rendered, /reserv/i);
  assert.equal((rendered.match(/\?/g) ?? []).length, 1);
});

test("quote context contains exact grounded amount without exposing selected internal room id", async () => {
  const state = baseState();
  state.quote = {
    status: "observed",
    observationRevision: 5,
    dependencyFingerprint: "quote-dep-5",
    dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "groundedSelection"],
    roomIds: ["room-internal-1"],
    amountCents: 1234500,
    currency: "ARS",
    observedAt: "2026-09-13T17:01:00Z",
  };
  const step = {
    kind: "RESPOND",
    responseIntent: "quote_result",
    groundedReferences: [{ kind: "quote", observationRevision: 5, roomIds: ["room-internal-1"] }],
  };
  const candidate = await build(state, step, "response-quote");
  assert.equal(candidate.context.groundedFacts.find((item) => item.factId === "quote_total")?.displayValue, "ARS 12.345,00");
  assert.equal(JSON.stringify(candidate.context).includes("room-internal-1"), false);
  assert.match(renderOperationalResponse(candidate.context), /ARS 12\.345,00/);
});

test("approval response is causally bound to the exact approval-required operation", async () => {
  const state = baseState();
  state.preparedOperation = {
    operationId: "op-1",
    operationType: "reserve",
    capabilityId: "reserve_single",
    toolId: "hms.createReservation",
    operationFingerprint: "op-fp-1",
    dependencyFingerprint: "write-dep-1",
    dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "availability", "groundedSelection", "operationIntent"],
    canonicalInputSnapshot: { roomId: "room-internal-1", guestId: "trusted-internal", checkIn: "2026-10-10", checkOut: "2026-10-12" },
    status: "approval_required",
  };
  const candidate = await build(state, { kind: "WAIT", reason: "approval_pending", correlationId: "op-1" }, "response-approval");
  assert.equal(candidate.context.purpose, "approval_required");
  assert.equal(JSON.stringify(candidate.context).includes("trusted-internal"), false);

  const changed = structuredClone(state);
  changed.stateRevision += 1;
  changed.preparedOperation.status = "approved";
  const admission = await admitResponseForPublication(candidate, changed);
  assert.deepEqual(admission, { ok: false, failureCode: "RESPONSE_DEPENDENCY_STALE" });
});

test("unrelated preference revision does not make a causally current response stale", async () => {
  const state = baseState();
  const candidate = await build(state, availabilityStep(), "response-causal");
  const changed = structuredClone(state);
  changed.stateRevision += 1;
  changed.preferences = [fact("vista a la montaña", 2)];
  const result = await admitResponseForPublication(candidate, changed);
  assert.equal(result.ok, true);
  assert.equal(result.admission.revisionChangedSinceBuild, true);
  assert.equal(result.admission.expectedStateRevision, changed.stateRevision);
});

test("changed availability dependency makes old response stale even if revision metadata is otherwise plausible", async () => {
  const state = baseState();
  const candidate = await build(state, availabilityStep(), "response-stale-availability");
  const changed = structuredClone(state);
  changed.stateRevision += 1;
  changed.availability.dependencyFingerprint = "availability-dep-new";
  const result = await admitResponseForPublication(candidate, changed);
  assert.deepEqual(result, { ok: false, failureCode: "RESPONSE_DEPENDENCY_STALE" });
});

test("rendering does not activate DialogueAnchor or PendingClarification", async () => {
  const state = baseState();
  const candidate = await build(state, selectionAskStep(), "response-not-published");
  renderOperationalResponse(candidate.context);
  assert.equal(state.conversationControl, undefined);
  const admission = await admitResponseForPublication(candidate, state);
  assert.equal(admission.ok, true);
  const commit = commitAcceptedPublication({
    state,
    admission: admission.admission,
    eventId: "publish-denied",
    publishedAt: "2026-09-13T17:02:00Z",
    channelAccepted: false,
  });
  assert.deepEqual(commit, { ok: false, failureCode: "OUTPUT_NOT_ACCEPTED" });
  assert.equal(state.conversationControl, undefined);
});

test("publication commit activates anchor and pending clarification only after channel acceptance", async () => {
  const state = baseState();
  const candidate = await build(state, selectionAskStep(), "response-published");
  const admission = await admitResponseForPublication(candidate, state);
  assert.equal(admission.ok, true);
  const commit = commitAcceptedPublication({
    state,
    admission: admission.admission,
    eventId: "publish-1",
    publishedAt: "2026-09-13T17:03:00Z",
    channelAccepted: true,
  });
  assert.equal(commit.ok, true);
  const control = commit.reduction.nextState.conversationControl;
  assert.equal(control.lastPublishedResponseId, "response-published");
  assert.equal(control.pendingClarification.field, "selection");
  assert.deepEqual(control.activeDialogueAnchor.presentedEntities.map((item) => item.roomNumber), ["101", "202"]);
});

test("validate-then-state-change publication race is rejected by reducer revision guard", async () => {
  const state = baseState();
  const candidate = await build(state, availabilityStep(), "response-race");
  const admission = await admitResponseForPublication(candidate, state);
  assert.equal(admission.ok, true);
  const raced = structuredClone(state);
  raced.stateRevision += 1;
  raced.preferences = [fact("silenciosa", 2)];
  const commit = commitAcceptedPublication({
    state: raced,
    admission: admission.admission,
    eventId: "publish-race",
    publishedAt: "2026-09-13T17:04:00Z",
    channelAccepted: true,
  });
  assert.equal(commit.ok, false);
  assert.equal(commit.failureCode, "PUBLICATION_EVENT_REJECTED_STATE_REVISION_CONFLICT");
  assert.equal(raced.conversationControl, undefined);
});

test("after unrelated race, causal re-admission can commit against the new revision", async () => {
  const state = baseState();
  const candidate = await build(state, availabilityStep(), "response-readmit");
  const changed = structuredClone(state);
  changed.stateRevision += 1;
  changed.preferences = [fact("piso alto", 2)];
  const readmission = await admitResponseForPublication(candidate, changed);
  assert.equal(readmission.ok, true);
  const commit = commitAcceptedPublication({
    state: changed,
    admission: readmission.admission,
    eventId: "publish-readmitted",
    publishedAt: "2026-09-13T17:05:00Z",
    channelAccepted: true,
  });
  assert.equal(commit.ok, true);
  assert.equal(commit.reduction.nextState.conversationControl.lastPublishedResponseId, "response-readmit");
});

test("an older admitted response cannot overwrite a newer published anchor", async () => {
  const state = baseState();
  const oldCandidate = await build(state, selectionAskStep(), "response-old");
  const oldAdmission = await admitResponseForPublication(oldCandidate, state);
  assert.equal(oldAdmission.ok, true);

  const newerCandidate = await build(state, { kind: "ASK", field: "guests", reason: "guests_required", dialogueAnchorSpec: { kind: "guests" } }, "response-new");
  const newerAdmission = await admitResponseForPublication(newerCandidate, state);
  assert.equal(newerAdmission.ok, true);
  const newerCommit = commitAcceptedPublication({
    state,
    admission: newerAdmission.admission,
    eventId: "publish-new",
    publishedAt: "2026-09-13T17:06:00Z",
    channelAccepted: true,
  });
  assert.equal(newerCommit.ok, true);

  const staleCommit = commitAcceptedPublication({
    state: newerCommit.reduction.nextState,
    admission: oldAdmission.admission,
    eventId: "publish-old-late",
    publishedAt: "2026-09-13T17:07:00Z",
    channelAccepted: true,
  });
  assert.equal(staleCommit.ok, false);
  assert.equal(staleCommit.failureCode, "PUBLICATION_EVENT_REJECTED_STATE_REVISION_CONFLICT");
  assert.equal(newerCommit.reduction.nextState.conversationControl.activeDialogueAnchor.kind, "guests");
});

test("later ordinal grounding follows the actually published semantic entity order", async () => {
  const state = baseState();
  const candidate = await build(state, selectionAskStep(), "response-anchor-order");
  const admission = await admitResponseForPublication(candidate, state);
  assert.equal(admission.ok, true);
  const committed = commitAcceptedPublication({
    state,
    admission: admission.admission,
    eventId: "publish-anchor-order",
    publishedAt: "2026-09-13T17:08:00Z",
    channelAccepted: true,
  });
  assert.equal(committed.ok, true);
  const nextState = committed.reduction.nextState;

  const output = {
    classification: "task",
    taskSemanticChanges: {
      requestedSelectionReference: { op: "set", value: { kind: "ordinal", ordinal: 2, scope: "observation_scoped" } },
    },
  };
  const result = applyInterpreterTurnToPlanner({
    state: nextState,
    output,
    planner: new HotelTaskPlanner(),
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities: buildHotelDomainCapabilities(["hms.checkAvailability", "hms.getQuote", "hms.createReservation", "hms.createMultiReservation"]),
    meta: {
      eventId: "user-after-anchor",
      sourceRevision: 2,
      dialogueAnchor: nextState.conversationControl.activeDialogueAnchor,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextState.groundedSelection.status, "grounded");
  assert.deepEqual(result.nextState.groundedSelection.roomIds, ["room-internal-2"]);
});
