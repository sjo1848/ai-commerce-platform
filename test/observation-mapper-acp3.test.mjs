import test from 'node:test';
import assert from 'node:assert/strict';
import { HotelTaskPlanner } from '../dist/core/hotel-task-planner.js';
import {
  HOTEL_TASK_DEFINITION_V1,
  buildHotelDomainCapabilities,
  capabilityPreconditionFingerprint,
  hotelCapabilityDependencyProjection,
} from '../dist/core/planning.js';
import { mapToolOutcomeToTaskEvent } from '../dist/core/observation-mapper.js';
import { applyToolOutcomeToPlanner } from '../dist/core/observation-replan-boundary.js';
import { reduceTaskState } from '../dist/core/task-reducer.js';

const visibleTools = [
  'hms.checkAvailability','hms.getQuote','hms.createReservation','hms.createMultiReservation',
  'hms.cancelReservation','hms.cancelMultiReservation',
];
const capabilities = buildHotelDomainCapabilities(visibleTools);
const planner = new HotelTaskPlanner();

function baseState() {
  return {
    taskId: 'task-obs', sessionId: 'session-obs', taskType: 'hotel_reservation_domain', lifecycle: 'active',
    stateRevision: 0, recentEventIds: [], requestedStay: {}, preferences: [],
    availability: { status: 'not_queried', rooms: [], dependencyKeys: [] },
    quote: { status: 'not_queried', roomIds: [], dependencyKeys: [] },
    groundedSelection: { status: 'none', roomIds: [], dependencyKeys: [] },
    bookings: [], execution: { status: 'not_started' },
  };
}

function stayState(goal = 'reservation') {
  const state = baseState();
  state.requestedGoal = { value: goal, provenance: { source: 'user', revision: 1 } };
  state.requestedStay = {
    checkIn: { value: '2027-03-10', provenance: { source: 'user', revision: 1 } },
    checkOut: { value: '2027-03-12', provenance: { source: 'user', revision: 1 } },
    guests: { value: 2, provenance: { source: 'user', revision: 1 } },
  };
  return state;
}

function pendingAvailabilityState(goal = 'reservation') {
  const state = stayState(goal);
  const projection = hotelCapabilityDependencyProjection(state, 'availability');
  const cap = capabilities.availability;
  assert.ok(projection && cap);
  const fingerprint = capabilityPreconditionFingerprint(HOTEL_TASK_DEFINITION_V1, cap, projection);
  state.pendingToolInvocation = {
    invocationId: 'inv-av', capabilityId: 'availability', status: 'pending', dependencyFingerprint: fingerprint,
    dependencyKeys: [...cap.dependencyKeys], inputSnapshot: { checkIn: '2027-03-10', checkOut: '2027-03-12', guests: 2 },
    startedAt: '2026-09-13T17:00:00Z',
  };
  state.availability = {
    status: 'pending', dependencyFingerprint: fingerprint, dependencyKeys: [...cap.dependencyKeys],
    querySnapshot: { checkIn: '2027-03-10', checkOut: '2027-03-12', guests: 2 }, rooms: [],
  };
  return state;
}

function pendingQuoteState() {
  const state = stayState('quote');
  const availabilityProjection = hotelCapabilityDependencyProjection(state, 'availability');
  const availabilityCap = capabilities.availability;
  assert.ok(availabilityProjection && availabilityCap);
  const availabilityFingerprint = capabilityPreconditionFingerprint(HOTEL_TASK_DEFINITION_V1, availabilityCap, availabilityProjection);
  state.availability = {
    status: 'observed', observationRevision: 3, dependencyFingerprint: availabilityFingerprint,
    dependencyKeys: [...availabilityCap.dependencyKeys], querySnapshot: { checkIn: '2027-03-10', checkOut: '2027-03-12', guests: 2 },
    guestCapacityCoverage: 'enforced', rooms: [{ roomId: 'room-101', roomNumber: '101', roomType: 'Standard', capacity: 2 }],
    observedAt: '2026-09-13T17:00:00Z',
  };
  state.groundedSelection = {
    status: 'grounded', roomIds: ['room-101'], basedOnAvailabilityRevision: 3,
    dependencyFingerprint: 'selection-fp', dependencyKeys: ['availability','requestedSelectionReference'],
  };
  const projection = hotelCapabilityDependencyProjection(state, 'quote');
  const cap = capabilities.quote;
  assert.ok(projection && cap);
  const fingerprint = capabilityPreconditionFingerprint(HOTEL_TASK_DEFINITION_V1, cap, projection);
  state.pendingToolInvocation = {
    invocationId: 'inv-quote', capabilityId: 'quote', status: 'pending', dependencyFingerprint: fingerprint,
    dependencyKeys: [...cap.dependencyKeys], inputSnapshot: { roomId: 'room-101', checkIn: '2027-03-10', checkOut: '2027-03-12' },
    startedAt: '2026-09-13T17:01:00Z',
  };
  state.quote = { status: 'pending', dependencyFingerprint: fingerprint, dependencyKeys: [...cap.dependencyKeys], roomIds: [] };
  return state;
}

function executingState(capabilityId, canonicalInput, operationType = 'reserve') {
  const state = stayState('reservation');
  state.preparedOperation = {
    operationId: 'op-1', operationType, capabilityId,
    toolId: HOTEL_TASK_DEFINITION_V1.capabilities[capabilityId].toolId,
    operationFingerprint: 'op-fp', dependencyFingerprint: 'dep-fp',
    dependencyKeys: ['operationIntent'], canonicalInputSnapshot: canonicalInput, status: 'approved',
  };
  state.execution = { status: 'executing', operationId: 'op-1', operationFingerprint: 'op-fp', dependencyFingerprint: 'dep-fp' };
  return state;
}

function successEnvelope(correlation, result, revision = 10) {
  return { outcome: 'success', eventId: `event-${revision}`, observationRevision: revision, observedAt: '2026-09-13T17:05:00Z', correlation, result };
}

test('HMS availability maps only normalized room facts and preserves capacity limitation', () => {
  const state = pendingAvailabilityState();
  const envelope = successEnvelope({ kind: 'invocation', invocationId: 'inv-av' }, {
    source: 'hms', truth: 'transactional', hotelId: 'hotel-1', start: '2027-03-10', end: '2027-03-12',
    capacityMode: 'not_modeled', requestedGuests: 2, capacityFilterApplied: false, traceId: 'trace-secret',
    rooms: [{ id: 'room-101', roomNumber: '101', roomType: 'Standard', status: 'AVAILABLE', priceCents: 90000, currency: 'ARS' }],
  });
  const mapped = mapToolOutcomeToTaskEvent(state, envelope);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.event.kind, 'availability_observed');
  assert.deepEqual(mapped.event.rooms, [{ roomId: 'room-101', roomNumber: '101', roomType: 'Standard' }]);
  assert.equal(mapped.event.guestCapacityCoverage, 'not_modeled');
  assert.equal('priceCents' in mapped.event.rooms[0], false);
  assert.equal(JSON.stringify(mapped.event).includes('trace-secret'), false);
});

test('availability result reduces and replans to bounded selection without exposing raw payload', () => {
  const state = pendingAvailabilityState();
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: successEnvelope({ kind: 'invocation', invocationId: 'inv-av' }, {
      source: 'hms', truth: 'transactional', hotelId: 'hotel-1', start: '2027-03-10', end: '2027-03-12',
      capacityMode: 'not_modeled', requestedGuests: 2, capacityFilterApplied: false, traceId: 't',
      rooms: [{ id: 'room-101', roomNumber: '101', roomType: 'Standard', status: 'AVAILABLE', priceCents: 90000, currency: 'ARS' }],
    }),
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextState.availability.status, 'observed');
  assert.equal(result.nextState.availability.guestCapacityCoverage, 'not_modeled');
  assert.equal(result.nextStep.kind, 'ASK');
  assert.equal(result.nextStep.field, 'selection');
  assert.deepEqual(result.nextStep.presentationContext.roomIds, ['room-101']);
});

test('zero availability is business truth, not tool failure or automatic retry', () => {
  const state = pendingAvailabilityState('availability');
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: successEnvelope({ kind: 'invocation', invocationId: 'inv-av' }, {
      source: 'hms', truth: 'transactional', hotelId: 'hotel-1', start: '2027-03-10', end: '2027-03-12',
      capacityMode: 'not_modeled', requestedGuests: 2, capacityFilterApplied: false, traceId: 't', rooms: [],
    }, 11),
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextState.availability.status, 'observed');
  assert.equal(result.nextState.availability.rooms.length, 0);
  assert.deepEqual(result.nextStep, { kind: 'RESPOND', responseIntent: 'no_availability', groundedReferences: [{ kind: 'availability', observationRevision: 11, roomIds: [] }] });
});

test('malformed/mismatched availability fails closed and does not promote truth', () => {
  const state = pendingAvailabilityState();
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: successEnvelope({ kind: 'invocation', invocationId: 'inv-av' }, {
      source: 'hms', truth: 'transactional', start: '2099-01-01', end: '2099-01-02', capacityMode: 'not_modeled',
      requestedGuests: 2, capacityFilterApplied: false, rooms: [], traceId: 't',
    }, 12),
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, 'OBSERVATION_AVAILABILITY_RESULT_INVALID');
  assert.equal(result.nextState.availability.status, 'pending');
});

test('late result for a superseded invocation is ignored before reducer/planner', () => {
  const state = pendingAvailabilityState();
  state.pendingToolInvocation = { ...state.pendingToolInvocation, status: 'superseded' };
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: successEnvelope({ kind: 'invocation', invocationId: 'inv-av' }, {
      source: 'hms', truth: 'transactional', start: '2027-03-10', end: '2027-03-12', capacityMode: 'not_modeled',
      requestedGuests: 2, capacityFilterApplied: false, rooms: [], traceId: 't',
    }, 13),
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, 'OBSERVATION_INVOCATION_BINDING_MISMATCH');
});

test('quote maps exact selected room and amount into TaskState then grounded response step', () => {
  const state = pendingQuoteState();
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: successEnvelope({ kind: 'invocation', invocationId: 'inv-quote' }, {
      source: 'hms', truth: 'transactional', hotelId: 'hotel-1', roomId: 'room-101', start: '2027-03-10', end: '2027-03-12',
      nights: 2, nightlyRateCents: 90000, totalCents: 180000, currency: 'ARS', traceId: 'hidden',
    }, 14),
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextState.quote.amountCents, 180000);
  assert.equal(result.nextState.quote.currency, 'ARS');
  assert.equal(result.nextStep.kind, 'RESPOND');
  assert.equal(result.nextStep.responseIntent, 'quote_result');
});

test('single reservation success is bound to executing operation and becomes COMPLETE', () => {
  const state = executingState('reserve_single', { guestId: 'guest-1', roomId: 'room-101', checkIn: '2027-03-10', checkOut: '2027-03-12' });
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: successEnvelope({ kind: 'operation', operationId: 'op-1' }, {
      source: 'hms', truth: 'transactional', hotelId: 'hotel-1', bookingId: 'booking-1', guestId: 'guest-1', roomId: 'room-101',
      start: '2027-03-10', end: '2027-03-12', status: 'CONFIRMED', totalCents: 180000, currency: 'ARS', replayed: false, traceId: 't',
    }, 20),
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextState.execution.status, 'confirmed');
  assert.equal(result.nextState.bookings[0].bookingId, 'booking-1');
  assert.deepEqual(result.nextState.bookings[0].roomIds, ['room-101']);
  assert.equal(result.nextStep.kind, 'COMPLETE');
  assert.equal(result.nextStep.responseIntent, 'booking_created');
});

test('multi reservation confirmed is reduced atomically with every real booking id', () => {
  const state = executingState('reserve_multi', { guestId: 'guest-1', roomIds: ['room-101','room-102'], checkIn: '2027-03-10', checkOut: '2027-03-12' });
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: successEnvelope({ kind: 'operation', operationId: 'op-1' }, {
      source: 'hms', truth: 'transactional', hotelId: 'hotel-1', outcome: 'confirmed',
      bookingIds: ['booking-a','booking-b'], createdBookingIds: ['booking-a','booking-b'], compensatedBookingIds: [], traceId: 't',
    }, 21),
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mappedEvent.kind, 'bookings_created');
  assert.equal(result.nextState.execution.status, 'confirmed');
  assert.equal(result.nextState.execution.outcomeKind, 'bookings_created');
  assert.deepEqual(result.nextState.bookings.map((booking) => booking.bookingId), ['booking-a','booking-b']);
  assert.deepEqual(result.nextState.bookings.map((booking) => booking.roomIds[0]), ['room-101','room-102']);
  assert.equal(result.nextStep.kind, 'COMPLETE');
});

test('multi reservation compensation failure preserves surviving booking truth and degrades', () => {
  const state = executingState('reserve_multi', { guestId: 'guest-1', roomIds: ['room-101','room-102'], checkIn: '2027-03-10', checkOut: '2027-03-12' });
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: successEnvelope({ kind: 'operation', operationId: 'op-1' }, {
      source: 'hms', truth: 'transactional', hotelId: 'hotel-1', outcome: 'compensation_failed',
      bookingIds: ['booking-a'], createdBookingIds: ['booking-a'], compensatedBookingIds: [], failedRoomId: 'room-102', traceId: 't',
    }, 22),
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mappedEvent.kind, 'operation_partial_outcome');
  assert.equal(result.nextState.execution.status, 'failed');
  assert.equal(result.nextState.execution.outcomeKind, 'booking_created_partial');
  assert.equal(result.nextState.bookings[0].bookingId, 'booking-a');
  assert.equal(result.nextStep.kind, 'DEGRADE');
  assert.equal(result.nextStep.reasonCode, 'MULTI_RESERVATION_COMPENSATION_FAILED');
});

test('executor failure is normalized without trusting raw exception/prose', () => {
  const state = executingState('reserve_single', { guestId: 'guest-1', roomId: 'room-101', checkIn: '2027-03-10', checkOut: '2027-03-12' });
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: {
      outcome: 'failure', eventId: 'event-failure', observationRevision: 23, observedAt: '2026-09-13T17:05:00Z',
      correlation: { kind: 'operation', operationId: 'op-1' }, failureCode: 'TOOL_EXECUTION_FAILED',
    },
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextState.execution.status, 'failed');
  assert.equal(result.nextStep.kind, 'DEGRADE');
  assert.equal(result.nextStep.reasonCode, 'TOOL_EXECUTION_FAILED');
});

test('multi cancellation partial failure atomically records cancelled subset and failed operation state', () => {
  const state = executingState('cancel_multi', { bookingIds: ['booking-a','booking-b'] }, 'cancel');
  state.bookings = [
    { bookingId: 'booking-a', status: 'CONFIRMED', roomIds: ['room-101'], observationRevision: 1 },
    { bookingId: 'booking-b', status: 'CONFIRMED', roomIds: ['room-102'], observationRevision: 1 },
  ];
  const result = applyToolOutcomeToPlanner({
    state,
    envelope: successEnvelope({ kind: 'operation', operationId: 'op-1' }, {
      source: 'hms', truth: 'transactional', hotelId: 'hotel-1', outcome: 'partial_failure',
      bookingIds: ['booking-b'], cancelledBookingIds: ['booking-a'], failedBookingIds: ['booking-b'], traceId: 't',
    }, 24),
    planner, taskDefinition: HOTEL_TASK_DEFINITION_V1, capabilities,
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextState.execution.status, 'failed');
  assert.equal(result.nextState.execution.outcomeKind, 'booking_cancelled_partial');
  assert.equal(result.nextState.bookings.find((booking) => booking.bookingId === 'booking-a').status, 'cancelled');
  assert.equal(result.nextState.bookings.find((booking) => booking.bookingId === 'booking-b').status, 'CONFIRMED');
  assert.equal(result.nextStep.kind, 'DEGRADE');
});
