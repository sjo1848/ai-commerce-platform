import test from 'node:test';
import assert from 'node:assert/strict';
import { HotelTaskPlanner } from '../dist/core/hotel-task-planner.js';
import { HOTEL_TASK_DEFINITION_V1, buildHotelDomainCapabilities } from '../dist/core/planning.js';

const planner = new HotelTaskPlanner();
const capabilities = buildHotelDomainCapabilities([
  'hms.checkAvailability','hms.getQuote','hms.createReservation','hms.createMultiReservation',
  'hms.cancelReservation','hms.cancelMultiReservation'
]);
const fact = (value, revision=1) => ({ value, provenance:{source:'user',revision} });
function context(state, trigger={}) { return { state, trigger:{origin:'user',...trigger}, taskDefinition:HOTEL_TASK_DEFINITION_V1, capabilities }; }
function baseState(overrides={}) { return {
  taskId:'t1', sessionId:'s1', taskType:'hotel_reservation_domain', lifecycle:'active', stateRevision:1,
  recentEventIds:[], requestedGoal:fact('reservation'),
  requestedStay:{checkIn:fact('2027-01-15'),checkOut:fact('2027-01-17'),guests:fact(2)}, preferences:[],
  availability:{status:'not_queried',rooms:[],dependencyKeys:[]}, quote:{status:'not_queried',roomIds:[],dependencyKeys:[]},
  groundedSelection:{status:'none',roomIds:[],dependencyKeys:[]}, bookings:[], execution:{status:'not_started'}, ...overrides
}; }
function groundedState() {
  const initial=baseState();
  const availability=planner.plan(context(initial));
  const withAvailability={...initial,availability:{status:'observed',observationRevision:5,dependencyFingerprint:availability.preconditionFingerprint,dependencyKeys:['requestedStay.checkIn','requestedStay.checkOut','requestedStay.guests'],querySnapshot:availability.groundedInput,rooms:[{roomId:'r101',roomNumber:'101'}],observedAt:'x'}};
  return {...withAvailability,groundedSelection:{status:'grounded',roomIds:['r101'],basedOnAvailabilityRevision:5,dependencyFingerprint:'sel-fp',dependencyKeys:['availability','requestedSelectionReference']}};
}
function approvalState(status='approval_required') {
  const state={...groundedState(),operationIntent:{kind:'reserve',status:'active',provenance:{source:'user',revision:7}}};
  const proposal=planner.plan(context(state));
  return {...state,preparedOperation:{operationId:'op1',operationType:'reserve',operationFingerprint:'ofp',dependencyFingerprint:proposal.preconditionFingerprint,dependencyKeys:['requestedStay.checkIn','requestedStay.checkOut','availability','groundedSelection','operationIntent'],canonicalInputSnapshot:proposal.groundedInput,status}};
}

test('abort never claims success while durable intent or approval-bound operation remains active',()=>{
  const step=planner.plan(context(approvalState(),{abortDirective:true}));
  assert.deepEqual(step,{kind:'DEGRADE',reasonCode:'ABORT_STATE_TRANSITION_REQUIRED',recoverable:true,responseIntent:'operation_abort_not_applied'});
});

test('abort acknowledges only after reducer-visible intent clear and operation invalidation',()=>{
  const state=approvalState();
  const cleaned={...state,operationIntent:undefined,preparedOperation:{...state.preparedOperation,status:'invalidated'}};
  assert.deepEqual(planner.plan(context(cleaned,{abortDirective:true})),{kind:'RESPOND',responseIntent:'operation_aborted',groundedReferences:[]});
});

test('abort cannot imply rollback after execution was admitted',()=>{
  const state={...approvalState('approved'),execution:{status:'executing',operationId:'op1'}};
  const step=planner.plan(context(state,{abortDirective:true}));
  assert.equal(step.kind,'DEGRADE'); assert.equal(step.reasonCode,'ABORT_TOO_LATE_EXECUTION_COMMITTED');
});

test('social/help/ack is serviced without advancing an incomplete workflow',()=>{
  const incomplete=baseState({requestedStay:{}});
  assert.deepEqual(planner.plan(context(incomplete,{interactionDirective:'social'})),{kind:'RESPOND',responseIntent:'social',groundedReferences:[]});
});

test('interaction remains serviceable while approval is pending without executing it',()=>{
  assert.deepEqual(planner.plan(context(approvalState(),{interactionDirective:'acknowledge'})),{kind:'RESPOND',responseIntent:'acknowledge',groundedReferences:[]});
});

test('interaction during admitted execution never creates another business action',()=>{
  const state={...approvalState('approved'),execution:{status:'executing',operationId:'op1'}};
  assert.deepEqual(planner.plan(context(state,{interactionDirective:'help'})),{kind:'RESPOND',responseIntent:'help',groundedReferences:[]});
});

test('approval invalidation control responds to invalidation instead of silently proposing the write again',()=>{
  const state=approvalState();
  const invalidated={...state,preparedOperation:{...state.preparedOperation,status:'invalidated'}};
  assert.deepEqual(
    planner.plan(context(invalidated,{origin:'server',controlKind:'approval_invalidated'})),
    {kind:'RESPOND',responseIntent:'approval_invalidated',groundedReferences:[{kind:'operation',operationId:'op1'}]},
  );
});
