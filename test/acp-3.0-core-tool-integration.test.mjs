import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuditSink } from "../dist/core/audit.js";
import { AgentCoreExecutor } from "../dist/core/executor.js";
import { InMemoryIdempotencyStore } from "../dist/core/idempotency.js";
import { PolicyEngine } from "../dist/core/policy.js";
import { CoreToolAdmission } from "../dist/core/tool-admission.js";
import { ToolRegistry } from "../dist/core/tool-registry.js";
import { InMemoryUsageSink } from "../dist/core/usage.js";
import { hotelDomainCapabilities } from "../dist/cognitive/hotel-task-definition.js";
import { planHotelTask } from "../dist/cognitive/hotel-task-planner.js";
import {
  createOrchestrationCycleRecord,
  runHotelPlanningCycle,
  serverControlDisposition,
} from "../dist/cognitive/orchestration-cycle.js";
import {
  integrateHotelPlannedToolCall,
  recoverPendingHotelRead,
  resumeApprovedHotelOperation,
} from "../dist/cognitive/core-tool-integration.js";
import { reduceTaskState } from "../dist/cognitive/task-state-reducer.js";

const NOW = "2026-09-16T03:45:00.000Z";
const capabilities = hotelDomainCapabilities();

function context(toolPolicies = {}) {
  return {
    requestId: "request-i6",
    tenant: {
      id: "tenant-i6",
      slug: "tenant-i6",
      status: "active",
      allowedToolIds: ["hms.checkAvailability", "hms.getQuote", "hms.createReservation"],
      toolPolicies,
    },
    actor: {
      id: "actor-i6",
      type: "customer",
      roles: ["customer"],
      permissions: ["hms.availability.read", "hms.quote.read", "hms.reservation.write"],
    },
    session: {
      id: "session-i6",
      tenantId: "tenant-i6",
      actorId: "actor-i6",
      channel: "webchat",
      createdAt: "2026-09-16T03:00:00.000Z",
      expiresAt: "2026-09-17T03:00:00.000Z",
    },
    now: NOW,
  };
}

function baseState(goal = "availability") {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-i6",
    taskId: "task-i6",
    lifecycle: "active",
    stateRevision: 2,
    recentEventIds: [],
    user: {
      requestedGoal: goal,
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      preferences: [],
    },
    observations: { executionResults: [], failures: [] },
    control: {},
    provenance: {},
  };
}

function reservationState() {
  const state = baseState("reservation");
  state.stateRevision = 5;
  state.user.operationIntent = "reserve";
  state.user.requestedSelectionReference = { kind: "room_number", value: "101" };
  state.observations.availability = {
    observationId: "availability-i6",
    status: "observed",
    source: "tool",
    query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    rooms: [{ roomId: "room-101", roomNumber: "101", capacity: 2 }],
    dependencyFingerprint: "availability-i6-fp",
    dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  };
  state.control.groundedSelection = {
    roomIds: ["room-101"],
    sourceObservationId: "availability-i6",
    authority: "server",
    dependencyFingerprint: "selection-i6-fp",
    dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
  };
  return state;
}

function fixture(toolPolicies = {}) {
  const registry = new ToolRegistry();
  const calls = { availability: 0, reservation: 0, metas: [] };
  registry.register({
    id: "hms.checkAvailability",
    primitive: "CHECK",
    description: "test availability",
    risk: "read",
    sideEffect: "none",
    requiredPermissions: ["hms.availability.read"],
    validateInput(input) {
      if (!input || typeof input !== "object") return { ok: false, message: "invalid" };
      const value = input;
      if (typeof value.checkIn !== "string" || typeof value.checkOut !== "string" || !Number.isInteger(value.guests)) return { ok: false, message: "invalid" };
      return { ok: true, value: { checkIn: value.checkIn, checkOut: value.checkOut, guests: value.guests } };
    },
    async execute(input) {
      calls.availability += 1;
      return { source: "fake", query: input, rooms: [{ id: "room-101", number: "101" }] };
    },
  });
  registry.register({
    id: "hms.createReservation",
    primitive: "RESERVE",
    description: "test reservation",
    risk: "write",
    sideEffect: "reversible",
    idempotencyMode: "core",
    requiredPermissions: ["hms.reservation.write"],
    validateInput(input, executionContext) {
      if (!executionContext || !input || typeof input !== "object") return { ok: false, message: "invalid" };
      const value = input;
      if (typeof value.roomId !== "string" || typeof value.checkIn !== "string" || typeof value.checkOut !== "string") return { ok: false, message: "invalid" };
      return {
        ok: true,
        value: {
          roomId: value.roomId,
          checkIn: value.checkIn,
          checkOut: value.checkOut,
          guestId: `guest:${executionContext.tenant.id}:${executionContext.actor.id}`,
        },
      };
    },
    async execute(input, _context, meta) {
      calls.reservation += 1;
      calls.metas.push(structuredClone(meta));
      return { source: "fake", bookingId: "booking-i6", input };
    },
  });
  const policy = new PolicyEngine();
  const audit = new InMemoryAuditSink();
  const usage = new InMemoryUsageSink();
  const idempotency = new InMemoryIdempotencyStore();
  const executor = new AgentCoreExecutor(registry, policy, audit, usage, idempotency);
  const admission = new CoreToolAdmission(registry, policy);
  return { registry, policy, audit, usage, idempotency, executor, admission, calls, executionContext: context(toolPolicies) };
}

async function plannedStep(state, acceptedEventId = "user-i6") {
  const trigger = { origin: "user", acceptedEventId };
  const step = await planHotelTask({ state, trigger, capabilities });
  assert.equal(step.kind, "CALL_TOOL");
  return {
    step,
    cycle: {
      cycleId: `cycle-${acceptedEventId}`,
      acceptedEventId,
      origin: "user",
      status: "planned",
      directives: {},
      plannedStep: structuredClone(step),
      plannedAtStateRevision: state.stateRevision,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

async function approvedReservationFixture(acceptedEventId = "approve-i6") {
  const state = reservationState();
  const { step, cycle } = await plannedStep(state, acceptedEventId);
  const f = fixture({ "hms.createReservation": "approval" });
  const proposed = await integrateHotelPlannedToolCall({
    state,
    cycle,
    step,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(proposed.kind, "write_approval_required");
  const operation = proposed.preparedOperation;
  const approved = reduceTaskState(proposed.state, {
    eventId: `approval-${acceptedEventId}`,
    kind: "server_control",
    sessionId: state.sessionId,
    taskId: state.taskId,
    expectedStateRevision: proposed.state.stateRevision,
    occurredAt: NOW,
    payload: {
      kind: "prepared_operation_status_changed",
      operationId: operation.operationId,
      operationFingerprint: operation.operationFingerprint,
      status: "approved",
    },
  });
  assert.equal(approved.accepted, true);
  return { state, f, operation, approvedState: approved.state };
}

test("Core admission canonicalizes without executing a side effect", async () => {
  const f = fixture({ "hms.createReservation": "approval" });
  const admission = await f.admission.admit(
    "hms.createReservation",
    { roomId: "room-101", checkIn: "2027-01-15", checkOut: "2027-01-17" },
    f.executionContext,
  );
  assert.equal(admission.decision, "approval_required");
  assert.equal(f.calls.reservation, 0);
  assert.equal(admission.canonicalInput.guestId, "guest:tenant-i6:actor-i6");
  assert.match(admission.operationFingerprint, /^[0-9a-f]{64}$/);
});

test("read CALL_TOOL is causally revalidated, recorded, dispatched, and raw result stays outside TaskState", async () => {
  const state = baseState();
  const { step, cycle } = await plannedStep(state, "read-i6");
  const f = fixture();
  const result = await integrateHotelPlannedToolCall({
    state,
    cycle,
    step,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(result.kind, "read_dispatched");
  assert.equal(f.calls.availability, 1);
  assert.equal(result.invocation.status, "dispatched");
  assert.equal(result.state.control.pendingToolInvocation.status, "dispatched");
  assert.equal(result.state.observations.availability, undefined);
  assert.equal(result.state.observations.quote, undefined);
  assert.deepEqual(result.rawResult.rooms, [{ id: "room-101", number: "101" }]);
});

test("tampered or stale CALL_TOOL is rejected before Core dispatch", async () => {
  const state = baseState();
  const { step, cycle } = await plannedStep(state, "stale-i6");
  const correction = {
    eventId: "user-corrects-dates-i6",
    kind: "user_semantic",
    sessionId: state.sessionId,
    taskId: state.taskId,
    expectedStateRevision: state.stateRevision,
    occurredAt: NOW,
    payload: { stay: { checkOut: { op: "set", value: "2027-01-18" } } },
  };
  const corrected = reduceTaskState(state, correction);
  assert.equal(corrected.accepted, true);
  const f = fixture();
  const stale = await integrateHotelPlannedToolCall({
    state: corrected.state,
    cycle,
    step,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(stale.kind, "stale_precondition");
  assert.equal(f.calls.availability, 0);

  const tamperedStep = { ...step, groundedInput: { ...step.groundedInput, guests: 9 } };
  const tamperedCycle = { ...cycle, plannedStep: tamperedStep };
  const tampered = await integrateHotelPlannedToolCall({
    state,
    cycle: tamperedCycle,
    step: tamperedStep,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(tampered.kind, "stale_precondition");
  assert.equal(f.calls.availability, 0);
});

test("Policy deny becomes one typed planning control and cannot auto-retry the tool", async () => {
  const state = baseState();
  const { step, cycle } = await plannedStep(state, "deny-i6");
  const f = fixture({ "hms.checkAvailability": "deny" });
  const result = await integrateHotelPlannedToolCall({
    state,
    cycle,
    step,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(result.kind, "control_failure");
  assert.equal(result.reasonCode, "policy_denied");
  assert.equal(f.calls.availability, 0);
  assert.equal(result.state.control.pendingToolInvocation, undefined);
  assert.equal(result.state.stateRevision, state.stateRevision + 1);
  assert.deepEqual(result.controlEvent.payload, {
    kind: "tool_control_failure",
    phase: "admission",
    capabilityId: "hms.checkAvailability",
    reasonCode: "policy_denied",
  });
  assert.equal(serverControlDisposition(result.controlEvent.payload), "PLANNING_TRIGGER");
  assert.equal(result.state.recentEventIds.includes(result.controlEvent.eventId), true);

  const trigger = { origin: "server", acceptedEventId: result.controlEvent.eventId };
  const failureCycle = createOrchestrationCycleRecord({
    cycleId: "cycle-policy-failure-i6",
    trigger,
    createdAt: NOW,
  });
  const planned = await runHotelPlanningCycle({
    state: result.state,
    primaryEvent: result.controlEvent,
    cycle: failureCycle,
    capabilities,
    now: NOW,
  });
  assert.equal(planned.kind, "planned");
  assert.equal(planned.nextStep.kind, "DEGRADE");
  assert.equal(planned.nextStep.reasonCode, "tool_control_failure");
  assert.equal(planned.nextStep.responseIntent, "tool_unavailable");
  assert.equal(f.calls.availability, 0);
});

test("tool observation failure degrades instead of becoming an automatic retry", async () => {
  const state = baseState();
  const next = await planHotelTask({
    state,
    trigger: { origin: "tool", acceptedEventId: "tool-failure-i6", observationKind: "failure" },
    capabilities,
  });
  assert.equal(next.kind, "DEGRADE");
  assert.equal(next.reasonCode, "tool_execution_failure");
  assert.equal(next.responseIntent, "tool_failure");
});

test("write proposal stores exact capability + canonical input and requires approval with zero side effects", async () => {
  const state = reservationState();
  const { step, cycle } = await plannedStep(state, "write-i6");
  const f = fixture({ "hms.createReservation": "approval" });
  const result = await integrateHotelPlannedToolCall({
    state,
    cycle,
    step,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(result.kind, "write_approval_required");
  assert.equal(f.calls.reservation, 0);
  assert.equal(result.preparedOperation.status, "approval_required");
  assert.equal(result.preparedOperation.capabilityId, "hms.createReservation");
  assert.equal(result.preparedOperation.capabilityContractIdentity, "hms.createReservation@hms-agent-v1");
  assert.equal(result.preparedOperation.inputSnapshot.guestId, "guest:tenant-i6:actor-i6");
  assert.equal(result.state.control.preparedOperation.operationId, result.preparedOperation.operationId);
});

test("validated approval resumes the exact PreparedOperation without Planner and executes once", async () => {
  const { f, operation, approvedState } = await approvedReservationFixture("approve-i6");
  const resumed = await resumeApprovedHotelOperation({
    state: approvedState,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(resumed.kind, "executed");
  assert.equal(f.calls.reservation, 1);
  assert.equal(f.calls.metas[0].humanApproved, true);
  assert.equal(f.calls.metas[0].approvedOperationFingerprint, operation.operationFingerprint);
  assert.equal(f.calls.metas[0].idempotencyKey, operation.operationId);
  assert.equal(resumed.rawResult.input.guestId, "guest:tenant-i6:actor-i6");
});

test("replaying the same approved PreparedOperation is Core-idempotent", async () => {
  const { f, operation, approvedState } = await approvedReservationFixture("replay-i6");
  const first = await resumeApprovedHotelOperation({
    state: approvedState,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  const second = await resumeApprovedHotelOperation({
    state: approvedState,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(first.kind, "executed");
  assert.equal(second.kind, "executed");
  assert.equal(f.calls.reservation, 1);
  assert.equal(first.preparedOperation.operationId, operation.operationId);
  assert.equal(second.preparedOperation.operationId, operation.operationId);
  assert.deepEqual(second.rawResult, first.rawResult);
});

test("approved operation without exact capability identity is invalidated and never executed", async () => {
  const state = reservationState();
  const { step, cycle } = await plannedStep(state, "missing-capability-i6");
  const f = fixture({ "hms.createReservation": "approval" });
  const proposed = await integrateHotelPlannedToolCall({
    state,
    cycle,
    step,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(proposed.kind, "write_approval_required");
  const legacyOperation = structuredClone(proposed.preparedOperation);
  delete legacyOperation.capabilityId;
  delete legacyOperation.capabilityContractIdentity;
  legacyOperation.status = "approved";
  const legacyState = structuredClone(proposed.state);
  legacyState.control.preparedOperation = legacyOperation;
  const result = await resumeApprovedHotelOperation({
    state: legacyState,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(result.kind, "invalidated");
  assert.equal(result.reason, "prepared_capability_identity_missing_or_stale");
  assert.equal(result.state.control.preparedOperation.status, "invalidated");
  assert.equal(f.calls.reservation, 0);
});

test("approved operation with drifted capability contract identity is invalidated before execution", async () => {
  const { f, approvedState } = await approvedReservationFixture("contract-drift-i6");
  const drifted = structuredClone(approvedState);
  drifted.control.preparedOperation.capabilityContractIdentity = "hms.createReservation@drifted";
  const result = await resumeApprovedHotelOperation({
    state: drifted,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(result.kind, "invalidated");
  assert.equal(result.reason, "prepared_capability_identity_missing_or_stale");
  assert.equal(result.state.control.preparedOperation.status, "invalidated");
  assert.equal(f.calls.reservation, 0);
});

test("pending read recovery redispatches same admitted identity before lease expiry", async () => {
  const state = baseState();
  const { step } = await plannedStep(state, "recover-i6");
  const pendingState = structuredClone(state);
  pendingState.control.pendingToolInvocation = {
    invocationId: "inv-recover-i6",
    capabilityId: step.capabilityId,
    status: "admitted",
    inputSnapshot: structuredClone(step.groundedInput),
    admittedAt: "2026-09-16T03:44:00.000Z",
    leaseExpiresAt: "2026-09-16T03:46:00.000Z",
    dependencyFingerprint: step.preconditionFingerprint,
    dependencyPaths: ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  };
  const f = fixture();
  const result = await recoverPendingHotelRead({
    state: pendingState,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(result.kind, "redispatched");
  assert.equal(result.invocation.invocationId, "inv-recover-i6");
  assert.equal(result.invocation.status, "dispatched");
  assert.equal(f.calls.availability, 1);
});

test("expired read lease terminalizes then emits one recovery planning control without dispatch", async () => {
  const state = baseState();
  const { step } = await plannedStep(state, "expired-i6");
  const pendingState = structuredClone(state);
  pendingState.control.pendingToolInvocation = {
    invocationId: "inv-expired-i6",
    capabilityId: step.capabilityId,
    status: "admitted",
    inputSnapshot: structuredClone(step.groundedInput),
    admittedAt: "2026-09-16T03:40:00.000Z",
    leaseExpiresAt: "2026-09-16T03:44:59.000Z",
    dependencyFingerprint: step.preconditionFingerprint,
    dependencyPaths: ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  };
  const f = fixture();
  const result = await recoverPendingHotelRead({
    state: pendingState,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(result.kind, "terminal");
  assert.equal(result.status, "expired");
  assert.equal(result.reasonCode, "lease_expired");
  assert.equal(result.state.control.pendingToolInvocation.status, "expired");
  assert.equal(result.state.stateRevision, pendingState.stateRevision + 2);
  assert.equal(result.controlEvents.length, 2);
  assert.equal(result.controlEvents[0].payload.kind, "invocation_terminal");
  assert.deepEqual(result.planningControlEvent.payload, {
    kind: "tool_control_failure",
    phase: "recovery",
    capabilityId: "hms.checkAvailability",
    reasonCode: "lease_expired",
  });
  assert.equal(serverControlDisposition(result.planningControlEvent.payload), "PLANNING_TRIGGER");
  assert.equal(f.calls.availability, 0);
});

test("recovery policy deny terminalizes before emitting bounded planning control", async () => {
  const state = baseState();
  const { step } = await plannedStep(state, "recovery-deny-i6");
  const pendingState = structuredClone(state);
  pendingState.control.pendingToolInvocation = {
    invocationId: "inv-recovery-deny-i6",
    capabilityId: step.capabilityId,
    status: "admitted",
    inputSnapshot: structuredClone(step.groundedInput),
    admittedAt: "2026-09-16T03:44:00.000Z",
    leaseExpiresAt: "2026-09-16T03:46:00.000Z",
    dependencyFingerprint: step.preconditionFingerprint,
    dependencyPaths: ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
  };
  const f = fixture({ "hms.checkAvailability": "deny" });
  const result = await recoverPendingHotelRead({
    state: pendingState,
    context: f.executionContext,
    admission: f.admission,
    executor: f.executor,
    now: NOW,
  });
  assert.equal(result.kind, "terminal");
  assert.equal(result.status, "failed");
  assert.equal(result.reasonCode, "policy_denied");
  assert.equal(result.state.control.pendingToolInvocation.status, "failed");
  assert.equal(result.controlEvents.length, 2);
  assert.equal(result.planningControlEvent.payload.kind, "tool_control_failure");
  assert.equal(result.planningControlEvent.payload.reasonCode, "policy_denied");
  assert.equal(f.calls.availability, 0);
});
