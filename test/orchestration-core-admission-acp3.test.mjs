import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../dist/core/tool-registry.js';
import { PolicyEngine } from '../dist/core/policy.js';
import { HotelTaskPlanner } from '../dist/core/hotel-task-planner.js';
import {
  HOTEL_TASK_DEFINITION_V1,
  buildHotelDomainCapabilities,
  capabilityPreconditionFingerprint,
  hotelCapabilityDependencyProjection,
} from '../dist/core/planning.js';
import { applyInterpreterTurnToPlanner } from '../dist/core/interpreter-turn-boundary.js';
import { admitPlannerToolProposal } from '../dist/core/planner-tool-admission.js';

function emptyState() {
  return {
    taskId: 'task-int', sessionId: 'session-int', taskType: 'hotel_reservation_domain', lifecycle: 'active',
    stateRevision: 0, recentEventIds: [], requestedStay: {}, preferences: [],
    availability: { status: 'not_queried', rooms: [], dependencyKeys: [] },
    quote: { status: 'not_queried', roomIds: [], dependencyKeys: [] },
    groundedSelection: { status: 'none', roomIds: [], dependencyKeys: [] }, bookings: [], execution: { status: 'not_started' },
  };
}

function setup() {
  const registry = new ToolRegistry();
  const counters = { availability: 0, reserve: 0 };
  registry.register({
    id: 'hms.checkAvailability', primitive: 'CHECK', description: 'availability', risk: 'read', sideEffect: 'none',
    requiredPermissions: ['hms.availability.read'],
    validateInput(input) {
      if (!input || typeof input !== 'object') return { ok: false, message: 'bad input' };
      const value = input;
      return { ok: true, value: { checkIn: value.checkIn, checkOut: value.checkOut, guests: value.guests } };
    },
    async execute(input) { counters.availability += 1; return { rooms: [], ...input }; },
  });
  registry.register({
    id: 'hms.createReservation', primitive: 'RESERVE', description: 'reserve', risk: 'write', sideEffect: 'reversible',
    requiredPermissions: ['hms.reservation.write'],
    validateInput(input, context) {
      if (!input || typeof input !== 'object' || !context) return { ok: false, message: 'bad input' };
      const value = input;
      return { ok: true, value: { roomId: value.roomId, checkIn: value.checkIn, checkOut: value.checkOut, guestId: `guest:${context.actor.id}` } };
    },
    async execute(input) { counters.reserve += 1; return { bookingId: 'booking-int', ...input }; },
  });
  const capabilities = buildHotelDomainCapabilities(['hms.checkAvailability','hms.createReservation']);
  const context = {
    requestId: 'request-int', now: '2026-09-13T17:00:00Z',
    tenant: {
      id: 'tenant-int', slug: 'tenant-int', status: 'active',
      allowedToolIds: ['hms.checkAvailability','hms.createReservation'],
      toolPolicies: { 'hms.checkAvailability': 'auto', 'hms.createReservation': 'approval' },
    },
    actor: { id: 'actor-int', type: 'customer', roles: [], permissions: ['hms.availability.read','hms.reservation.write'] },
    session: { id: 'session-int', tenantId: 'tenant-int', actorId: 'actor-int', channel: 'webchat', createdAt: '2026-09-13T16:00:00Z', expiresAt: '2026-09-14T16:00:00Z' },
  };
  return {
    registry, policy: new PolicyEngine(), planner: new HotelTaskPlanner(), capabilities, context, counters,
    admission: { taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities, registry, policy: new PolicyEngine(), context },
  };
}

test('ACP-3.0.8.5 full offline chain turns validated stay semantics into admitted availability read without execution', async () => {
  const runtime = setup();
  const state = emptyState();
  const output = {
    classification: 'task',
    taskSemanticChanges: {
      requestedGoal: { op: 'set', value: 'reservation' },
      checkIn: { op: 'set', value: '2027-02-10' },
      checkOut: { op: 'set', value: '2027-02-12' },
      guests: { op: 'set', value: 2 },
    },
  };
  const boundary = applyInterpreterTurnToPlanner({
    state, output, planner: runtime.planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities: runtime.capabilities,
    meta: { eventId: 'semantic-read', sourceRevision: 1 },
  });
  assert.equal(boundary.ok, true);
  assert.equal(boundary.nextStep.kind, 'CALL_TOOL');
  assert.equal(boundary.nextStep.capabilityId, 'availability');

  const admitted = await admitPlannerToolProposal(boundary.nextState, boundary.nextStep, runtime.admission, {
    eventId: 'read-admitted', invocationId: 'inv-int', startedAt: runtime.context.now,
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.kind, 'read_started');
  assert.equal(admitted.nextState.pendingToolInvocation.status, 'pending');
  assert.equal(runtime.counters.availability, 0);
  assert.equal(runtime.counters.reserve, 0);
});

test('ACP-3.0.8.5 full offline chain turns reserve commit into exact approval-bound prepared operation without execution', async () => {
  const runtime = setup();
  const state = emptyState();
  state.requestedGoal = { value: 'reservation', provenance: { source: 'user', revision: 1 } };
  state.requestedStay = {
    checkIn: { value: '2027-02-10', provenance: { source: 'user', revision: 1 } },
    checkOut: { value: '2027-02-12', provenance: { source: 'user', revision: 1 } },
    guests: { value: 2, provenance: { source: 'user', revision: 1 } },
  };
  const availabilityCapability = runtime.capabilities.availability;
  const availabilityProjection = hotelCapabilityDependencyProjection(state, 'availability');
  assert.ok(availabilityCapability);
  assert.ok(availabilityProjection);
  state.availability = {
    status: 'observed', observationRevision: 5,
    dependencyFingerprint: capabilityPreconditionFingerprint(HOTEL_TASK_DEFINITION_V1, availabilityCapability, availabilityProjection),
    dependencyKeys: [...availabilityCapability.dependencyKeys],
    querySnapshot: { checkIn: '2027-02-10', checkOut: '2027-02-12', guests: 2 },
    rooms: [{ roomId: 'room-101', roomNumber: '101', capacity: 2 }], observedAt: '2026-09-13T16:59:00Z',
  };
  state.groundedSelection = {
    status: 'grounded', roomIds: ['room-101'], basedOnAvailabilityRevision: 5,
    dependencyFingerprint: 'selection-int', dependencyKeys: ['availability','requestedSelectionReference'],
  };

  const output = {
    classification: 'task',
    taskSemanticChanges: { operationIntent: { op: 'set', value: { kind: 'reserve', status: 'active' } } },
  };
  const boundary = applyInterpreterTurnToPlanner({
    state, output, planner: runtime.planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities: runtime.capabilities,
    meta: { eventId: 'semantic-write', sourceRevision: 2 },
  });
  assert.equal(boundary.ok, true);
  assert.equal(boundary.nextStep.kind, 'CALL_TOOL');
  assert.equal(boundary.nextStep.capabilityId, 'reserve_single');

  const admitted = await admitPlannerToolProposal(boundary.nextState, boundary.nextStep, runtime.admission, {
    eventId: 'write-admitted', operationId: 'op-int', startedAt: runtime.context.now,
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.kind, 'write_prepared');
  assert.equal(admitted.nextState.preparedOperation.status, 'approval_required');
  assert.equal(admitted.nextState.preparedOperation.capabilityId, 'reserve_single');
  assert.equal(admitted.nextState.preparedOperation.toolId, 'hms.createReservation');
  assert.equal(admitted.nextState.preparedOperation.canonicalInputSnapshot.guestId, 'guest:actor-int');
  assert.equal(runtime.counters.availability, 0);
  assert.equal(runtime.counters.reserve, 0);
});
