import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../dist/core/tool-registry.js';
import { PolicyEngine } from '../dist/core/policy.js';
import {
  HOTEL_TASK_DEFINITION_V1,
  buildHotelDomainCapabilities,
  capabilityPreconditionFingerprint,
  hotelCapabilityDependencyProjection,
} from '../dist/core/planning.js';
import {
  admitPlannerToolProposal,
  admitPreparedOperationExecution,
} from '../dist/core/planner-tool-admission.js';
import { reduceTaskState } from '../dist/core/task-reducer.js';

function emptyState() {
  return {
    taskId: 'task-1', sessionId: 'session-1', taskType: 'hotel_reservation_domain', lifecycle: 'active',
    stateRevision: 0, recentEventIds: [], requestedStay: {}, preferences: [],
    availability: { status: 'not_queried', rooms: [], dependencyKeys: [] },
    quote: { status: 'not_queried', roomIds: [], dependencyKeys: [] },
    groundedSelection: { status: 'none', roomIds: [], dependencyKeys: [] },
    bookings: [], execution: { status: 'not_started' },
  };
}

function stayState() {
  const state = emptyState();
  state.requestedStay = {
    checkIn: { value: '2027-01-15', provenance: { source: 'user', revision: 1 } },
    checkOut: { value: '2027-01-17', provenance: { source: 'user', revision: 1 } },
    guests: { value: 2, provenance: { source: 'user', revision: 1 } },
  };
  return state;
}

function reservationState() {
  const state = stayState();
  state.availability = {
    status: 'observed', observationRevision: 7, dependencyFingerprint: 'availability-current',
    dependencyKeys: ['requestedStay.checkIn','requestedStay.checkOut','requestedStay.guests'],
    rooms: [{ roomId: 'room-101', roomNumber: '101', capacity: 2 }],
  };
  state.groundedSelection = {
    status: 'grounded', roomIds: ['room-101'], basedOnAvailabilityRevision: 7,
    dependencyFingerprint: 'selection-current', dependencyKeys: ['availability','requestedSelectionReference'],
  };
  state.operationIntent = { kind: 'reserve', status: 'active', provenance: { source: 'user', revision: 2 } };
  return state;
}

function setup({ reservePolicy = 'approval', availabilityPolicy = 'auto' } = {}) {
  const registry = new ToolRegistry();
  const counters = { availabilityExecute: 0, reserveExecute: 0 };
  registry.register({
    id: 'hms.checkAvailability', primitive: 'CHECK', description: 'availability', risk: 'read', sideEffect: 'none',
    requiredPermissions: ['hms.availability.read'],
    validateInput(input) {
      if (!input || typeof input !== 'object') return { ok: false, message: 'bad input' };
      const value = input;
      if (typeof value.checkIn !== 'string' || typeof value.checkOut !== 'string' || !Number.isInteger(value.guests)) return { ok: false, message: 'bad input' };
      return { ok: true, value: { checkIn: value.checkIn, checkOut: value.checkOut, guests: value.guests } };
    },
    async execute(input) { counters.availabilityExecute += 1; return { rooms: [], ...input }; },
  });
  registry.register({
    id: 'hms.createReservation', primitive: 'RESERVE', description: 'reserve', risk: 'write', sideEffect: 'reversible',
    requiredPermissions: ['hms.reservation.write'],
    validateInput(input, context) {
      if (!input || typeof input !== 'object' || !context) return { ok: false, message: 'bad input' };
      const value = input;
      if (typeof value.roomId !== 'string' || typeof value.checkIn !== 'string' || typeof value.checkOut !== 'string') return { ok: false, message: 'bad input' };
      return { ok: true, value: { roomId: value.roomId, checkIn: value.checkIn, checkOut: value.checkOut, guestId: `guest:${context.actor.id}` } };
    },
    async execute(input) { counters.reserveExecute += 1; return { bookingId: 'booking-1', ...input }; },
  });

  const context = {
    requestId: 'request-1', now: '2026-09-13T16:00:00Z',
    tenant: {
      id: 'tenant-1', slug: 'tenant', status: 'active',
      allowedToolIds: ['hms.checkAvailability','hms.createReservation'],
      toolPolicies: { 'hms.checkAvailability': availabilityPolicy, 'hms.createReservation': reservePolicy },
    },
    actor: { id: 'actor-1', type: 'customer', roles: [], permissions: ['hms.availability.read','hms.reservation.write'] },
    session: { id: 'session-1', tenantId: 'tenant-1', actorId: 'actor-1', channel: 'webchat', createdAt: '2026-09-13T15:00:00Z', expiresAt: '2026-09-14T15:00:00Z' },
  };
  const capabilities = buildHotelDomainCapabilities(['hms.checkAvailability','hms.createReservation']);
  return { registry, policy: new PolicyEngine(), context, capabilities, counters };
}

function callFor(state, capabilityId, capabilities) {
  const capability = capabilities[capabilityId];
  assert.ok(capability);
  const projection = hotelCapabilityDependencyProjection(state, capabilityId);
  assert.ok(projection);
  let groundedInput;
  if (capabilityId === 'availability') groundedInput = { checkIn: projection.checkIn, checkOut: projection.checkOut, guests: projection.guests };
  else if (capabilityId === 'reserve_single') groundedInput = { roomId: projection.roomIds[0], checkIn: projection.checkIn, checkOut: projection.checkOut };
  else throw new Error(`unsupported test capability ${capabilityId}`);
  return {
    kind: 'CALL_TOOL', capabilityId, groundedInput,
    preconditionFingerprint: capabilityPreconditionFingerprint(HOTEL_TASK_DEFINITION_V1, capability, projection),
    correlationIntent: capabilityId === 'availability' ? 'check_availability' : 'reserve',
    effectClass: capability.effectClass,
  };
}

function deps(setupResult) {
  return {
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities: setupResult.capabilities,
    registry: setupResult.registry,
    policy: setupResult.policy,
    context: setupResult.context,
  };
}

test('read proposal is admitted into reducer without executing the tool', async () => {
  const runtime = setup();
  const state = stayState();
  const call = callFor(state, 'availability', runtime.capabilities);
  const result = await admitPlannerToolProposal(state, call, deps(runtime), {
    eventId: 'read-start', invocationId: 'inv-1', startedAt: runtime.context.now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'read_started');
  assert.equal(result.nextState.pendingToolInvocation.status, 'pending');
  assert.equal(result.nextState.pendingToolInvocation.capabilityId, 'availability');
  assert.equal(runtime.counters.availabilityExecute, 0);
});

test('planner grounded input tampering fails closed before policy/execution', async () => {
  const runtime = setup();
  const state = stayState();
  const call = callFor(state, 'availability', runtime.capabilities);
  call.groundedInput = { ...call.groundedInput, guests: 9 };
  const result = await admitPlannerToolProposal(state, call, deps(runtime), {
    eventId: 'tamper', invocationId: 'inv-x', startedAt: runtime.context.now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, 'TOOL_ADMISSION_GROUNDED_INPUT_MISMATCH');
  assert.equal(runtime.counters.availabilityExecute, 0);
});

test('stale planner precondition is rejected after a user correction', async () => {
  const runtime = setup();
  const state = stayState();
  const call = callFor(state, 'availability', runtime.capabilities);
  const corrected = reduceTaskState(state, {
    kind: 'user_semantic', eventId: 'correction', taskId: 'task-1', sessionId: 'session-1', expectedStateRevision: 0,
    sourceRevision: 2, patch: { checkIn: { op: 'set', value: '2027-01-16' } },
  });
  assert.equal(corrected.accepted, true);
  const result = await admitPlannerToolProposal(corrected.nextState, call, deps(runtime), {
    eventId: 'stale', invocationId: 'inv-stale', startedAt: runtime.context.now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, 'TOOL_ADMISSION_STALE_PRECONDITION');
});

test('read policy requiring approval is not silently bypassed', async () => {
  const runtime = setup({ availabilityPolicy: 'approval' });
  const state = stayState();
  const call = callFor(state, 'availability', runtime.capabilities);
  const result = await admitPlannerToolProposal(state, call, deps(runtime), {
    eventId: 'read-approval', invocationId: 'inv-a', startedAt: runtime.context.now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, 'TOOL_ADMISSION_READ_APPROVAL_UNSUPPORTED');
});

test('write proposal persists exact capability/tool and canonical approval fingerprint without executing', async () => {
  const runtime = setup({ reservePolicy: 'approval' });
  const state = reservationState();
  const call = callFor(state, 'reserve_single', runtime.capabilities);
  const result = await admitPlannerToolProposal(state, call, deps(runtime), {
    eventId: 'prepare', operationId: 'op-1', startedAt: runtime.context.now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'write_prepared');
  assert.equal(result.nextState.preparedOperation.status, 'approval_required');
  assert.equal(result.nextState.preparedOperation.capabilityId, 'reserve_single');
  assert.equal(result.nextState.preparedOperation.toolId, 'hms.createReservation');
  assert.equal(result.nextState.preparedOperation.canonicalInputSnapshot.guestId, 'guest:actor-1');
  assert.equal(runtime.counters.reserveExecute, 0);

  const beforeApproval = await admitPreparedOperationExecution(result.nextState, deps(runtime), { eventId: 'exec-too-soon' });
  assert.equal(beforeApproval.ok, false);
  assert.equal(beforeApproval.failureCode, 'EXECUTION_ADMISSION_PREPARED_OPERATION_NOT_EXECUTABLE');
});

test('approved write resumes exact prepared operation and only returns an executor request', async () => {
  const runtime = setup({ reservePolicy: 'approval' });
  const state = reservationState();
  const call = callFor(state, 'reserve_single', runtime.capabilities);
  const prepared = await admitPlannerToolProposal(state, call, deps(runtime), {
    eventId: 'prepare-2', operationId: 'op-2', startedAt: runtime.context.now,
  });
  assert.equal(prepared.ok, true);
  const operation = prepared.nextState.preparedOperation;
  const approved = reduceTaskState(prepared.nextState, {
    kind: 'approval_state_changed', eventId: 'approve-2', taskId: 'task-1', sessionId: 'session-1',
    expectedStateRevision: prepared.nextState.stateRevision,
    operationId: operation.operationId,
    operationFingerprint: operation.operationFingerprint,
    dependencyFingerprint: operation.dependencyFingerprint,
    status: 'approved',
  });
  assert.equal(approved.accepted, true);

  const admitted = await admitPreparedOperationExecution(approved.nextState, deps(runtime), { eventId: 'exec-2' });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.nextState.execution.status, 'executing');
  assert.equal(admitted.executorRequest.toolId, 'hms.createReservation');
  assert.equal(admitted.executorRequest.meta.humanApproved, true);
  assert.equal(admitted.executorRequest.meta.approvedOperationFingerprint, operation.operationFingerprint);
  assert.equal(admitted.executorRequest.meta.idempotencyKey, 'acp3:task-1:op-2');
  assert.equal(runtime.counters.reserveExecute, 0);
});

test('approved operation cannot execute after its dependencies are corrected', async () => {
  const runtime = setup({ reservePolicy: 'approval' });
  const state = reservationState();
  const call = callFor(state, 'reserve_single', runtime.capabilities);
  const prepared = await admitPlannerToolProposal(state, call, deps(runtime), {
    eventId: 'prepare-3', operationId: 'op-3', startedAt: runtime.context.now,
  });
  assert.equal(prepared.ok, true);
  const operation = prepared.nextState.preparedOperation;
  let reduced = reduceTaskState(prepared.nextState, {
    kind: 'approval_state_changed', eventId: 'approve-3', taskId: 'task-1', sessionId: 'session-1',
    expectedStateRevision: prepared.nextState.stateRevision,
    operationId: operation.operationId, operationFingerprint: operation.operationFingerprint,
    dependencyFingerprint: operation.dependencyFingerprint, status: 'approved',
  });
  reduced = reduceTaskState(reduced.nextState, {
    kind: 'user_semantic', eventId: 'late-correction', taskId: 'task-1', sessionId: 'session-1',
    expectedStateRevision: reduced.nextState.stateRevision, sourceRevision: 9,
    patch: { checkOut: { op: 'set', value: '2027-01-18' } },
  });
  assert.equal(reduced.nextState.preparedOperation.status, 'invalidated');
  const result = await admitPreparedOperationExecution(reduced.nextState, deps(runtime), { eventId: 'exec-stale' });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, 'EXECUTION_ADMISSION_PREPARED_OPERATION_NOT_EXECUTABLE');
  assert.equal(runtime.counters.reserveExecute, 0);
});

test('auto-policy write is prepared then execution-admitted without fabricating approval', async () => {
  const runtime = setup({ reservePolicy: 'auto' });
  const state = reservationState();
  const call = callFor(state, 'reserve_single', runtime.capabilities);
  const prepared = await admitPlannerToolProposal(state, call, deps(runtime), {
    eventId: 'prepare-auto', operationId: 'op-auto', startedAt: runtime.context.now,
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.nextState.preparedOperation.status, 'prepared');
  const admitted = await admitPreparedOperationExecution(prepared.nextState, deps(runtime), { eventId: 'exec-auto' });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.executorRequest.meta.humanApproved, undefined);
  assert.equal(runtime.counters.reserveExecute, 0);
});
