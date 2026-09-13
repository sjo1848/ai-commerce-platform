import test from 'node:test';
import assert from 'node:assert/strict';
import { HotelTaskPlanner } from '../dist/core/hotel-task-planner.js';
import {
  HOTEL_TASK_DEFINITION_V1,
  buildHotelDomainCapabilities,
  capabilityPreconditionFingerprint,
  hotelCapabilityDependencyProjection,
} from '../dist/core/planning.js';

const planner = new HotelTaskPlanner();
const capabilities = buildHotelDomainCapabilities([
  'hms.checkAvailability', 'hms.getQuote', 'hms.createReservation',
]);

function failedState() {
  return {
    taskId: 'task-failure-priority',
    sessionId: 'session-failure-priority',
    taskType: 'hotel_reservation_domain',
    lifecycle: 'active',
    stateRevision: 4,
    recentEventIds: [],
    requestedGoal: { value: 'reservation', provenance: { source: 'user', revision: 1 } },
    requestedStay: {
      checkIn: { value: '2027-04-10', provenance: { source: 'user', revision: 1 } },
      checkOut: { value: '2027-04-12', provenance: { source: 'user', revision: 1 } },
      guests: { value: 2, provenance: { source: 'user', revision: 1 } },
    },
    preferences: [],
    availability: { status: 'not_queried', rooms: [], dependencyKeys: [] },
    quote: { status: 'not_queried', roomIds: [], dependencyKeys: [] },
    groundedSelection: { status: 'none', roomIds: [], dependencyKeys: [] },
    bookings: [],
    operationIntent: { kind: 'reserve', status: 'active', provenance: { source: 'user', revision: 2 } },
    preparedOperation: {
      operationId: 'op-failed', operationType: 'reserve', capabilityId: 'reserve_single', toolId: 'hms.createReservation',
      operationFingerprint: 'op-fp', dependencyFingerprint: 'dep-fp',
      dependencyKeys: ['requestedStay.checkIn','requestedStay.checkOut','availability','groundedSelection','operationIntent'],
      canonicalInputSnapshot: { roomId: 'room-101', checkIn: '2027-04-10', checkOut: '2027-04-12', guestId: 'guest-1' },
      status: 'approved',
    },
    execution: {
      status: 'failed', operationId: 'op-failed', operationFingerprint: 'op-fp', dependencyFingerprint: 'dep-fp',
      failureCode: 'TOOL_EXECUTION_FAILED',
    },
  };
}

test('execution failure outranks an old approved PreparedOperation after a tool outcome', () => {
  const state = failedState();
  const step = planner.plan({
    state,
    trigger: { origin: 'tool', acceptedEventId: 'failure-event', observationKind: 'operation_execution_failed' },
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities,
  });
  assert.deepEqual(step, {
    kind: 'DEGRADE', reasonCode: 'TOOL_EXECUTION_FAILED', recoverable: true, responseIntent: 'operation_failed',
  });
});

test('explicit quote read can still be serviced after a prior execution failure', () => {
  const state = failedState();
  const availabilityProjection = hotelCapabilityDependencyProjection(state, 'availability');
  const availabilityCapability = capabilities.availability;
  assert.ok(availabilityProjection && availabilityCapability);
  const availabilityFingerprint = capabilityPreconditionFingerprint(HOTEL_TASK_DEFINITION_V1, availabilityCapability, availabilityProjection);
  state.availability = {
    status: 'observed', observationRevision: 5, dependencyFingerprint: availabilityFingerprint,
    dependencyKeys: [...availabilityCapability.dependencyKeys],
    querySnapshot: { checkIn: '2027-04-10', checkOut: '2027-04-12', guests: 2 },
    rooms: [{ roomId: 'room-101', roomNumber: '101', capacity: 2 }], guestCapacityCoverage: 'enforced',
    observedAt: '2026-09-13T17:10:00Z',
  };
  state.groundedSelection = {
    status: 'grounded', roomIds: ['room-101'], basedOnAvailabilityRevision: 5,
    dependencyFingerprint: 'selection-fp', dependencyKeys: ['availability','requestedSelectionReference'],
  };
  const quoteProjection = hotelCapabilityDependencyProjection(state, 'quote');
  const quoteCapability = capabilities.quote;
  assert.ok(quoteProjection && quoteCapability);
  const quoteFingerprint = capabilityPreconditionFingerprint(HOTEL_TASK_DEFINITION_V1, quoteCapability, quoteProjection);
  state.quote = {
    status: 'observed', observationRevision: 6, dependencyFingerprint: quoteFingerprint,
    dependencyKeys: [...quoteCapability.dependencyKeys], roomIds: ['room-101'], amountCents: 180000, currency: 'ARS',
    observedAt: '2026-09-13T17:11:00Z',
  };

  const step = planner.plan({
    state,
    trigger: { origin: 'user', readDirective: { kind: 'quote' } },
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities,
  });
  assert.equal(step.kind, 'RESPOND');
  assert.equal(step.responseIntent, 'quote_result');
});
