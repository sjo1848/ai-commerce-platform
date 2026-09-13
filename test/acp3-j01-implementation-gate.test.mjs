import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentCoreExecutor,
  HotelTaskPlanner,
  HOTEL_TASK_DEFINITION_V1,
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryUsageSink,
  PolicyEngine,
  ToolRegistry,
  admitPlannerToolProposal,
  admitPreparedOperationExecution,
  admitResponseForPublication,
  applyInterpreterTurnToPlanner,
  applyToolOutcomeToPlanner,
  buildHotelDomainCapabilities,
  buildResponsePublicationCandidate,
  commitAcceptedPublication,
  reduceTaskState,
  renderOperationalResponse,
} from "../dist/index.js";

function emptyState() {
  return {
    taskId: "task-j01",
    sessionId: "session-j01",
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

function setup() {
  const registry = new ToolRegistry();
  const policy = new PolicyEngine();
  const counters = { availability: 0, reserve: 0 };

  registry.register({
    id: "hms.checkAvailability",
    primitive: "CHECK",
    description: "offline J01 availability",
    risk: "read",
    sideEffect: "none",
    requiredPermissions: ["hms.availability.read"],
    validateInput(input) {
      if (!input || typeof input !== "object") return { ok: false, message: "bad input" };
      const value = input;
      if (typeof value.checkIn !== "string" || typeof value.checkOut !== "string" || !Number.isInteger(value.guests)) {
        return { ok: false, message: "bad input" };
      }
      return { ok: true, value: { checkIn: value.checkIn, checkOut: value.checkOut, guests: value.guests } };
    },
    async execute(input) {
      counters.availability += 1;
      return {
        source: "fake-hms",
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        guests: input.guests,
        rooms: [
          { id: "room-internal-101", roomNumber: "101", roomType: "Doble", capacity: 2 },
          { id: "room-internal-202", roomNumber: "202", roomType: "Suite", capacity: 2 },
        ],
      };
    },
  });

  registry.register({
    id: "hms.createReservation",
    primitive: "RESERVE",
    description: "offline J01 reservation",
    risk: "write",
    sideEffect: "reversible",
    idempotencyMode: "core",
    requiredPermissions: ["hms.reservation.write"],
    validateInput(input, context) {
      if (!input || typeof input !== "object" || !context) return { ok: false, message: "bad input" };
      const value = input;
      if (typeof value.roomId !== "string" || typeof value.checkIn !== "string" || typeof value.checkOut !== "string") {
        return { ok: false, message: "bad input" };
      }
      return {
        ok: true,
        value: {
          roomId: value.roomId,
          checkIn: value.checkIn,
          checkOut: value.checkOut,
          guestId: `guest:${context.actor.id}`,
        },
      };
    },
    async execute(input, context) {
      counters.reserve += 1;
      return {
        source: "hms",
        truth: "transactional",
        hotelId: "hotel-secret-j01",
        bookingId: "BOOK-J01-202",
        guestId: input.guestId,
        roomId: input.roomId,
        start: input.checkIn,
        end: input.checkOut,
        status: "confirmed",
        totalCents: 250000,
        currency: "ARS",
        replayed: false,
        traceId: context.requestId,
      };
    },
  });

  const capabilities = buildHotelDomainCapabilities([
    "hms.checkAvailability",
    "hms.createReservation",
  ]);
  const context = {
    requestId: "request-secret-j01",
    now: "2026-09-13T18:00:00Z",
    tenant: {
      id: "tenant-j01",
      slug: "tenant-j01",
      status: "active",
      allowedToolIds: ["hms.checkAvailability", "hms.createReservation"],
      toolPolicies: {
        "hms.checkAvailability": "auto",
        "hms.createReservation": "approval",
      },
    },
    actor: {
      id: "actor-j01",
      type: "customer",
      roles: [],
      permissions: ["hms.availability.read", "hms.reservation.write"],
    },
    session: {
      id: "session-j01",
      tenantId: "tenant-j01",
      actorId: "actor-j01",
      channel: "webchat",
      createdAt: "2026-09-13T17:00:00Z",
      expiresAt: "2026-09-14T17:00:00Z",
    },
  };
  const planner = new HotelTaskPlanner();
  const executor = new AgentCoreExecutor(
    registry,
    policy,
    new InMemoryAuditSink(),
    new InMemoryUsageSink(),
    new InMemoryIdempotencyStore(),
  );
  const admission = {
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities,
    registry,
    policy,
    context,
  };
  return { registry, policy, counters, capabilities, context, planner, executor, admission };
}

async function publish(state, nextStep, responseId, eventId) {
  const built = await buildResponsePublicationCandidate({ state, nextStep, responseId });
  assert.equal(built.ok, true, built.ok ? undefined : built.failureCode);
  const text = renderOperationalResponse(built.candidate.context);
  const admission = await admitResponseForPublication(built.candidate, state);
  assert.equal(admission.ok, true, admission.ok ? undefined : admission.failureCode);
  const committed = commitAcceptedPublication({
    state,
    admission: admission.admission,
    eventId,
    publishedAt: "2026-09-13T18:00:30Z",
    channelAccepted: true,
  });
  assert.equal(committed.ok, true, committed.ok ? undefined : committed.failureCode);
  return { text, candidate: built.candidate, state: committed.reduction.nextState };
}

function planServer(runtime, state) {
  return runtime.planner.plan({
    state,
    trigger: { origin: "server" },
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities: runtime.capabilities,
  });
}

test("ACP-3.0.8.7 J01 offline gate traverses interpretation, read, publication, grounding, HITL, exact execution and confirmed response", async () => {
  const runtime = setup();
  let state = emptyState();

  // Turn 1: semantic interpretation establishes the reservation goal and stay.
  const initialTurn = applyInterpreterTurnToPlanner({
    state,
    output: {
      classification: "task",
      taskSemanticChanges: {
        requestedGoal: { op: "set", value: "reservation" },
        checkIn: { op: "set", value: "2027-02-10" },
        checkOut: { op: "set", value: "2027-02-12" },
        guests: { op: "set", value: 2 },
      },
    },
    planner: runtime.planner,
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities: runtime.capabilities,
    meta: { eventId: "j01-user-stay", sourceRevision: 1 },
  });
  assert.equal(initialTurn.ok, true, initialTurn.ok ? undefined : initialTurn.failureCode);
  assert.equal(initialTurn.nextStep.kind, "CALL_TOOL");
  assert.equal(initialTurn.nextStep.capabilityId, "availability");

  // Core/Policy admission records the read before execution.
  const readAdmission = await admitPlannerToolProposal(
    initialTurn.nextState,
    initialTurn.nextStep,
    runtime.admission,
    {
      eventId: "j01-read-start",
      invocationId: "j01-inv-availability",
      startedAt: runtime.context.now,
    },
  );
  assert.equal(readAdmission.ok, true, readAdmission.ok ? undefined : readAdmission.failureCode);
  assert.equal(readAdmission.kind, "read_started");
  assert.equal(runtime.counters.availability, 0);

  // The local fake tool is executed through the real Core executor boundary.
  const availabilityRaw = await runtime.executor.execute(
    "hms.checkAvailability",
    readAdmission.event.inputSnapshot,
    runtime.context,
  );
  assert.equal(runtime.counters.availability, 1);

  // Raw result becomes reducer-owned observation before Planner/Renderer can see it.
  const availabilityOutcome = applyToolOutcomeToPlanner({
    state: readAdmission.nextState,
    envelope: {
      outcome: "success",
      eventId: "j01-availability-observed",
      observationRevision: 10,
      observedAt: "2026-09-13T18:00:05Z",
      correlation: { kind: "invocation", invocationId: "j01-inv-availability" },
      result: availabilityRaw,
    },
    planner: runtime.planner,
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities: runtime.capabilities,
  });
  assert.equal(availabilityOutcome.ok, true, availabilityOutcome.ok ? undefined : availabilityOutcome.failureCode);
  assert.equal(availabilityOutcome.nextStep.kind, "ASK");
  assert.equal(availabilityOutcome.nextStep.field, "selection");

  const optionsPublished = await publish(
    availabilityOutcome.nextState,
    availabilityOutcome.nextStep,
    "j01-response-options",
    "j01-publish-options",
  );
  assert.match(optionsPublished.text, /101/);
  assert.match(optionsPublished.text, /202/);
  const optionsSurface = JSON.stringify(optionsPublished.candidate.context);
  assert.equal(optionsSurface.includes("room-internal-101"), false);
  assert.equal(optionsSurface.includes("room-internal-202"), false);
  assert.deepEqual(
    optionsPublished.state.conversationControl.activeDialogueAnchor.presentedEntities.map((item) => item.roomNumber),
    ["101", "202"],
  );
  state = optionsPublished.state;

  // Turn 2: "la segunda" is grounded against exactly what was published.
  const selectionTurn = applyInterpreterTurnToPlanner({
    state,
    output: {
      classification: "task",
      taskSemanticChanges: {
        requestedSelectionReference: {
          op: "set",
          value: { kind: "ordinal", ordinal: 2, scope: "observation_scoped" },
        },
      },
    },
    planner: runtime.planner,
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities: runtime.capabilities,
    meta: {
      eventId: "j01-user-select-second",
      sourceRevision: 2,
      dialogueAnchor: state.conversationControl.activeDialogueAnchor,
    },
  });
  assert.equal(selectionTurn.ok, true, selectionTurn.ok ? undefined : selectionTurn.failureCode);
  assert.deepEqual(selectionTurn.nextState.groundedSelection.roomIds, ["room-internal-202"]);
  assert.equal(selectionTurn.nextStep.kind, "RESPOND");

  const selectionPublished = await publish(
    selectionTurn.nextState,
    selectionTurn.nextStep,
    "j01-response-selection",
    "j01-publish-selection",
  );
  state = selectionPublished.state;

  // Turn 3: explicit commit semantics are separate from selecting a room.
  const commitTurn = applyInterpreterTurnToPlanner({
    state,
    output: {
      classification: "task",
      taskSemanticChanges: {
        operationIntent: { op: "set", value: { kind: "reserve", status: "active" } },
      },
    },
    planner: runtime.planner,
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities: runtime.capabilities,
    meta: { eventId: "j01-user-reserve", sourceRevision: 3 },
  });
  assert.equal(commitTurn.ok, true, commitTurn.ok ? undefined : commitTurn.failureCode);
  assert.equal(commitTurn.nextStep.kind, "CALL_TOOL");
  assert.equal(commitTurn.nextStep.capabilityId, "reserve_single");
  assert.equal(commitTurn.nextStep.groundedInput.roomId, "room-internal-202");

  const writeAdmission = await admitPlannerToolProposal(
    commitTurn.nextState,
    commitTurn.nextStep,
    runtime.admission,
    {
      eventId: "j01-write-prepared",
      operationId: "j01-operation-reserve",
      startedAt: "2026-09-13T18:00:10Z",
    },
  );
  assert.equal(writeAdmission.ok, true, writeAdmission.ok ? undefined : writeAdmission.failureCode);
  assert.equal(writeAdmission.kind, "write_prepared");
  assert.equal(writeAdmission.nextState.preparedOperation.status, "approval_required");
  assert.equal(writeAdmission.nextState.preparedOperation.capabilityId, "reserve_single");
  assert.equal(writeAdmission.nextState.preparedOperation.toolId, "hms.createReservation");
  assert.equal(writeAdmission.nextState.preparedOperation.canonicalInputSnapshot.guestId, "guest:actor-j01");
  assert.equal(runtime.counters.reserve, 0);

  const approvalWait = planServer(runtime, writeAdmission.nextState);
  assert.equal(approvalWait.kind, "WAIT");
  assert.equal(approvalWait.reason, "approval_pending");
  const approvalPublished = await publish(
    writeAdmission.nextState,
    approvalWait,
    "j01-response-approval",
    "j01-publish-approval",
  );
  assert.match(approvalPublished.text, /aprobaci[oó]n/i);
  assert.equal(JSON.stringify(approvalPublished.candidate.context).includes("guest:actor-j01"), false);
  state = approvalPublished.state;

  // HITL approves the exact prepared operation; no re-interpretation or re-planning of the mutation.
  const operation = state.preparedOperation;
  const approved = reduceTaskState(state, {
    kind: "approval_state_changed",
    eventId: "j01-approval-accepted",
    taskId: state.taskId,
    sessionId: state.sessionId,
    expectedStateRevision: state.stateRevision,
    operationId: operation.operationId,
    operationFingerprint: operation.operationFingerprint,
    dependencyFingerprint: operation.dependencyFingerprint,
    status: "approved",
  });
  assert.equal(approved.accepted, true, approved.rejectionReason);

  const executionAdmission = await admitPreparedOperationExecution(
    approved.nextState,
    runtime.admission,
    { eventId: "j01-execution-started" },
  );
  assert.equal(executionAdmission.ok, true, executionAdmission.ok ? undefined : executionAdmission.failureCode);
  assert.equal(executionAdmission.nextState.execution.status, "executing");
  assert.equal(executionAdmission.executorRequest.toolId, "hms.createReservation");
  assert.equal(executionAdmission.executorRequest.meta.humanApproved, true);
  assert.equal(
    executionAdmission.executorRequest.meta.approvedOperationFingerprint,
    operation.operationFingerprint,
  );
  assert.equal(runtime.counters.reserve, 0);

  // Exactly one local fake mutation executes through AgentCoreExecutor after approval.
  const reservationRaw = await runtime.executor.execute(
    executionAdmission.executorRequest.toolId,
    executionAdmission.executorRequest.input,
    runtime.context,
    executionAdmission.executorRequest.meta,
  );
  assert.equal(runtime.counters.reserve, 1);

  const reservationOutcome = applyToolOutcomeToPlanner({
    state: executionAdmission.nextState,
    envelope: {
      outcome: "success",
      eventId: "j01-booking-observed",
      observationRevision: 20,
      observedAt: "2026-09-13T18:00:20Z",
      correlation: { kind: "operation", operationId: operation.operationId },
      result: reservationRaw,
    },
    planner: runtime.planner,
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities: runtime.capabilities,
  });
  assert.equal(reservationOutcome.ok, true, reservationOutcome.ok ? undefined : reservationOutcome.failureCode);
  assert.equal(reservationOutcome.nextStep.kind, "COMPLETE");
  assert.equal(reservationOutcome.nextState.execution.status, "confirmed");
  assert.equal(reservationOutcome.nextState.bookings.at(-1).bookingId, "BOOK-J01-202");

  const confirmedPublished = await publish(
    reservationOutcome.nextState,
    reservationOutcome.nextStep,
    "j01-response-confirmed",
    "j01-publish-confirmed",
  );
  assert.match(confirmedPublished.text, /confirmada/i);
  assert.match(confirmedPublished.text, /BOOK-J01-202/);
  const finalSurface = JSON.stringify(confirmedPublished.candidate.context);
  assert.equal(finalSurface.includes("room-internal-202"), false);
  assert.equal(finalSurface.includes("guest:actor-j01"), false);
  assert.equal(finalSurface.includes("hotel-secret-j01"), false);
  assert.equal(finalSurface.includes("request-secret-j01"), false);
  assert.equal(confirmedPublished.state.execution.status, "confirmed");
  assert.equal(confirmedPublished.state.conversationControl.activeDialogueAnchor, undefined);
  assert.equal(runtime.counters.availability, 1);
  assert.equal(runtime.counters.reserve, 1);
});
