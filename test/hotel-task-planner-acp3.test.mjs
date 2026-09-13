import test from 'node:test';
import assert from 'node:assert/strict';
import { HotelTaskPlanner } from '../dist/core/hotel-task-planner.js';
import { HOTEL_TASK_DEFINITION_V1, buildHotelDomainCapabilities } from '../dist/core/planning.js';

const planner = new HotelTaskPlanner();
const allTools = [
  'hms.checkAvailability','hms.getQuote','hms.createReservation','hms.createMultiReservation',
  'hms.cancelReservation','hms.cancelMultiReservation'
];
const caps = buildHotelDomainCapabilities(allTools);
const fact = (value, revision=1) => ({value, provenance:{source:'user',revision}});
function baseState(overrides={}) {
  return {
    taskId:'t1', sessionId:'s1', taskType:'hotel_reservation_domain', lifecycle:'active', stateRevision:1,
    recentEventIds:[], requestedStay:{}, preferences:[],
    availability:{status:'not_queried',rooms:[],dependencyKeys:[]},
    quote:{status:'not_queried',roomIds:[],dependencyKeys:[]},
    groundedSelection:{status:'none',roomIds:[],dependencyKeys:[]},
    bookings:[], execution:{status:'not_started'},
    ...overrides,
  };
}
function context(state, trigger={}, capabilities=caps) {
  return {state, trigger:{origin:'user',...trigger}, taskDefinition:HOTEL_TASK_DEFINITION_V1, capabilities};
}
function completeStay(extra={}) {
  return baseState({
    requestedGoal: fact('reservation'),
    requestedStay:{checkIn:fact('2027-01-15'),checkOut:fact('2027-01-17'),guests:fact(2)},
    ...extra,
  });
}
function availabilityCall(state=completeStay()) {
  const step=planner.plan(context(state));
  assert.equal(step.kind,'CALL_TOOL');
  assert.equal(step.capabilityId,'availability');
  return step;
}
function withObservedAvailability(state=completeStay(), rooms=[{roomId:'r101',roomNumber:'101'},{roomId:'r102',roomNumber:'102'}]) {
  const call=availabilityCall(state);
  return {
    ...state,
    availability:{status:'observed', observationRevision:5, dependencyFingerprint:call.preconditionFingerprint,
      dependencyKeys:['requestedStay.checkIn','requestedStay.checkOut','requestedStay.guests'], rooms, observedAt:'2026-09-13T00:00:00Z'}
  };
}
function withGroundedSelection(roomIds=['r101'], state=withObservedAvailability()) {
  return {...state, groundedSelection:{status:'grounded',roomIds,basedOnAvailabilityRevision:5,dependencyFingerprint:'sel-fp',dependencyKeys:['availability','requestedSelectionReference']}};
}

test('J01 asks dates first when stay is empty',()=>{
  const step=planner.plan(context(baseState({requestedGoal:fact('reservation')})));
  assert.deepEqual(step,{kind:'ASK',field:'dates',reason:'stay_dates_required',dialogueAnchorSpec:{kind:'dates'}});
});

test('J01 asks guests after dates',()=>{
  const state=baseState({requestedGoal:fact('reservation'),requestedStay:{checkIn:fact('2027-01-15'),checkOut:fact('2027-01-17')}});
  assert.equal(planner.plan(context(state)).field,'guests');
});

test('J01 complete stay calls availability with grounded input',()=>{
  const step=availabilityCall();
  assert.deepEqual(step.groundedInput,{checkIn:'2027-01-15',checkOut:'2027-01-17',guests:2});
  assert.equal(step.effectClass,'read');
  assert.match(step.preconditionFingerprint,/^dep:v1:/);
});

test('planner is deterministic for identical PlanningContext',()=>{
  const c=context(completeStay());
  assert.deepEqual(planner.plan(c),planner.plan(c));
});

test('matching pending availability waits instead of duplicating',()=>{
  const state=completeStay(); const call=availabilityCall(state);
  const pending={...state,pendingToolInvocation:{invocationId:'i1',capabilityId:'availability',status:'pending',dependencyFingerprint:call.preconditionFingerprint,dependencyKeys:[],inputSnapshot:call.groundedInput,startedAt:'x'},availability:{status:'pending',dependencyFingerprint:call.preconditionFingerprint,dependencyKeys:[],querySnapshot:call.groundedInput,rooms:[]}};
  assert.deepEqual(planner.plan(context(pending)),{kind:'WAIT',reason:'tool_pending',correlationId:'i1'});
});

test('availability observed for reservation asks selection with grounded presentation',()=>{
  const step=planner.plan(context(withObservedAvailability()));
  assert.equal(step.kind,'ASK'); assert.equal(step.field,'selection');
  assert.deepEqual(step.presentationContext.roomIds,['r101','r102']);
});

test('grounded selection without commit only acknowledges selection',()=>{
  const step=planner.plan(context(withGroundedSelection()));
  assert.deepEqual(step,{kind:'RESPOND',responseIntent:'selection_acknowledged',groundedReferences:[{kind:'selection',roomIds:['r101']}]});
});

test('explicit reserve single proposes one write capability',()=>{
  const state={...withGroundedSelection(),operationIntent:{kind:'reserve',status:'active',provenance:{source:'user',revision:7}}};
  const step=planner.plan(context(state));
  assert.equal(step.kind,'CALL_TOOL'); assert.equal(step.capabilityId,'reserve_single'); assert.equal(step.effectClass,'write');
  assert.deepEqual(step.groundedInput,{roomId:'r101',checkIn:'2027-01-15',checkOut:'2027-01-17'});
});

test('multi-room reserve uses native composite capability',()=>{
  const state={...withGroundedSelection(['r101','r102']),requestedRoomCount:fact(2),operationIntent:{kind:'reserve',status:'active',provenance:{source:'user',revision:7}}};
  const step=planner.plan(context(state));
  assert.equal(step.kind,'CALL_TOOL'); assert.equal(step.capabilityId,'reserve_multi');
  assert.deepEqual(step.groundedInput.roomIds,['r101','r102']);
});

test('multi-room does not decompose into single writes when composite absent',()=>{
  const state={...withGroundedSelection(['r101','r102']),requestedRoomCount:fact(2),operationIntent:{kind:'reserve',status:'active',provenance:{source:'user',revision:7}}};
  const noMulti=buildHotelDomainCapabilities(allTools.filter(x=>x!=='hms.createMultiReservation'));
  const step=planner.plan(context(state,{},noMulti));
  assert.equal(step.kind,'DEGRADE'); assert.equal(step.reasonCode,'CAPABILITY_UNAVAILABLE_RESERVE_MULTI');
});

test('room count mismatch asks selection rather than mutating',()=>{
  const state={...withGroundedSelection(['r101']),requestedRoomCount:fact(2),operationIntent:{kind:'reserve',status:'active',provenance:{source:'user',revision:7}}};
  const step=planner.plan(context(state)); assert.equal(step.kind,'ASK'); assert.equal(step.field,'selection');
});

test('approval pending waits on exact operation',()=>{
  const state={...withGroundedSelection(),preparedOperation:{operationId:'op1',operationType:'reserve',operationFingerprint:'ofp',dependencyFingerprint:'dfp',dependencyKeys:['groundedSelection'],canonicalInputSnapshot:{roomId:'r101'},status:'approval_required'}};
  assert.deepEqual(planner.plan(context(state)),{kind:'WAIT',reason:'approval_pending',correlationId:'op1'});
});

test('read quote is serviced before approval pending',()=>{
  const state={...withGroundedSelection(),preparedOperation:{operationId:'op1',operationType:'reserve',operationFingerprint:'ofp',dependencyFingerprint:'dfp',dependencyKeys:['groundedSelection'],canonicalInputSnapshot:{roomId:'r101'},status:'approval_required'}};
  const step=planner.plan(context(state,{readDirective:{kind:'quote'}}));
  assert.equal(step.kind,'CALL_TOOL'); assert.equal(step.capabilityId,'quote');
});

test('prepared or approved operation never becomes a new planner mutation',()=>{
  for (const status of ['prepared','approved']) {
    const state={...withGroundedSelection(),preparedOperation:{operationId:'op1',operationType:'reserve',operationFingerprint:'ofp',dependencyFingerprint:'dfp',dependencyKeys:['groundedSelection'],canonicalInputSnapshot:{roomId:'r101'},status}};
    assert.deepEqual(planner.plan(context(state)),{kind:'WAIT',reason:'external_event',correlationId:'op1'});
  }
});

test('confirmed execution completes from grounded operation and booking',()=>{
  const state={...withGroundedSelection(),bookings:[{bookingId:'B1',observationRevision:9}],execution:{status:'confirmed',operationId:'op1',operationFingerprint:'ofp',dependencyFingerprint:'dfp',outcomeKind:'booking_created'}};
  const step=planner.plan(context(state)); assert.equal(step.kind,'COMPLETE'); assert.equal(step.completionReason,'booking_created');
  assert.deepEqual(step.groundedReferences,[{ kind:'operation',operationId:'op1'},{kind:'booking',bookingId:'B1'}]);
});

test('zero availability is truth, not failure or retry',()=>{
  const state=withObservedAvailability(completeStay({requestedGoal:fact('availability')}),[]);
  const step=planner.plan(context(state)); assert.deepEqual(step,{kind:'RESPOND',responseIntent:'no_availability',groundedReferences:[{kind:'availability',observationRevision:5,roomIds:[]}]});
});

test('failed availability does not auto-retry but explicit retry does',()=>{
  const state=completeStay({requestedGoal:fact('availability')}); const call=availabilityCall(state);
  const failed={...state,availability:{status:'failed',dependencyFingerprint:call.preconditionFingerprint,dependencyKeys:[],querySnapshot:call.groundedInput,roomIds:[]}};
  assert.equal(planner.plan(context(failed)).kind,'DEGRADE');
  const retried=planner.plan(context(failed,{retryDirective:{targetCapabilityId:'availability'}}));
  assert.equal(retried.kind,'CALL_TOOL'); assert.equal(retried.correlationIntent,'retry_availability');
});

test('quote with current observation responds without duplicate tool call',()=>{
  const reservation=withGroundedSelection();
  const quoteRequest=context({...reservation,requestedGoal:fact('quote')},{readDirective:{kind:'quote'}});
  const quoteCall=planner.plan(quoteRequest); assert.equal(quoteCall.kind,'CALL_TOOL'); assert.equal(quoteCall.capabilityId,'quote');
  const observed={...reservation,requestedGoal:fact('quote'),quote:{status:'observed',observationRevision:7,dependencyFingerprint:quoteCall.preconditionFingerprint,dependencyKeys:['groundedSelection'],roomIds:['r101'],amountCents:50000,currency:'ARS',observedAt:'x'}};
  const step=planner.plan(context(observed,{readDirective:{kind:'quote'}})); assert.equal(step.kind,'RESPOND'); assert.equal(step.responseIntent,'quote_result');
});

test('quote without grounded selection asks instead of inventing room',()=>{
  const state=withObservedAvailability(completeStay({requestedGoal:fact('quote')}));
  const step=planner.plan(context(state,{readDirective:{kind:'quote'}})); assert.equal(step.kind,'ASK'); assert.equal(step.field,'selection');
});

test('missing availability capability degrades honestly',()=>{
  const noAvailability=buildHotelDomainCapabilities(allTools.filter(x=>x!=='hms.checkAvailability'));
  const step=planner.plan(context(completeStay({requestedGoal:fact('availability')}),{},noAvailability));
  assert.equal(step.kind,'DEGRADE'); assert.equal(step.reasonCode,'CAPABILITY_UNAVAILABLE_AVAILABILITY');
});

test('cancel and modify fail closed without server-grounded booking target',()=>{
  for (const kind of ['cancel','modify']) {
    const state=baseState({requestedGoal:fact(kind==='cancel'?'cancellation':'modification'),bookingReference:fact({kind:'explicit_code',code:'B1'}),bookings:[{bookingId:'B1',observationRevision:1}],operationIntent:{kind,status:'active',provenance:{source:'user',revision:2}}});
    const step=planner.plan(context(state)); assert.equal(step.kind,'DEGRADE'); assert.equal(step.reasonCode,'BOOKING_TARGET_GROUNDING_REQUIRED');
  }
});

test('knowledge directive does not introduce implicit RAG',()=>{
  const step=planner.plan(context(baseState(),{readDirective:{kind:'knowledge',fields:['breakfast']}}));
  assert.equal(step.kind,'DEGRADE'); assert.equal(step.reasonCode,'KNOWLEDGE_CAPABILITY_UNAVAILABLE');
});

test('write retry stays outside planner ownership',()=>{
  const state={...baseState(),execution:{status:'failed',operationId:'op1',failureCode:'HMS'}};
  const step=planner.plan(context(state,{retryDirective:{targetCapabilityId:'reserve_single'}}));
  assert.equal(step.kind,'DEGRADE'); assert.equal(step.reasonCode,'WRITE_RETRY_NOT_PLANNER_OWNED');
});

test('non-active task returns bounded COMPLETE',()=>{
  const step=planner.plan(context(baseState({lifecycle:'abandoned'})));
  assert.deepEqual(step,{kind:'COMPLETE',completionReason:'task_abandoned',responseIntent:'task_abandoned',groundedReferences:[]});
});

test('TaskDefinition declares requirements and dependency keys instead of hiding them in planner code',()=>{
  assert.deepEqual(HOTEL_TASK_DEFINITION_V1.capabilities.availability.requiredFacts,['checkIn','checkOut','guests']);
  assert.ok(HOTEL_TASK_DEFINITION_V1.capabilities.reserve_single.dependencyKeys.includes('operationIntent'));
  assert.ok(HOTEL_TASK_DEFINITION_V1.capabilities.reserve_multi.dependencyKeys.includes('requestedRoomCount'));
  assert.equal(caps.modify, undefined);
});

test('write precondition changes with commit semantics and disappears when commit is cleared',()=>{
  const first={...withGroundedSelection(),operationIntent:{kind:'reserve',status:'active',targetSemanticReference:{kind:'room_number',roomNumber:'101',scope:'entity_scoped'},provenance:{source:'user',revision:7}}};
  const second={...first,operationIntent:{kind:'reserve',status:'active',targetSemanticReference:{kind:'ordinal',ordinal:1,scope:'observation_scoped'},provenance:{source:'user',revision:8}}};
  const a=planner.plan(context(first)); const b=planner.plan(context(second));
  assert.equal(a.kind,'CALL_TOOL'); assert.equal(b.kind,'CALL_TOOL');
  assert.notEqual(a.preconditionFingerprint,b.preconditionFingerprint);
  const cleared={...first,operationIntent:undefined};
  const c=planner.plan(context(cleared)); assert.equal(c.kind,'RESPOND');
});

test('synthetic J01 post-reducer traversal reaches approval wait then grounded completion without LLM planning',()=>{
  let state=baseState({requestedGoal:fact('reservation')});
  assert.equal(planner.plan(context(state)).field,'dates');
  state={...state,requestedStay:{checkIn:fact('2027-01-15'),checkOut:fact('2027-01-17')}};
  assert.equal(planner.plan(context(state)).field,'guests');
  state={...state,requestedStay:{...state.requestedStay,guests:fact(2)}};
  const availability=planner.plan(context(state)); assert.equal(availability.kind,'CALL_TOOL'); assert.equal(availability.capabilityId,'availability');
  state={...state,availability:{status:'observed',observationRevision:1,dependencyFingerprint:availability.preconditionFingerprint,dependencyKeys:['requestedStay.checkIn','requestedStay.checkOut','requestedStay.guests'],querySnapshot:availability.groundedInput,rooms:[{roomId:'r101',roomNumber:'101'}],observedAt:'x'}};
  assert.equal(planner.plan(context(state)).field,'selection');
  state={...state,groundedSelection:{status:'grounded',roomIds:['r101'],basedOnAvailabilityRevision:1,dependencyFingerprint:'selection-1',dependencyKeys:['availability','requestedSelectionReference']}};
  assert.equal(planner.plan(context(state)).responseIntent,'selection_acknowledged');
  state={...state,operationIntent:{kind:'reserve',status:'active',provenance:{source:'user',revision:5}}};
  const reserve=planner.plan(context(state)); assert.equal(reserve.kind,'CALL_TOOL'); assert.equal(reserve.capabilityId,'reserve_single');
  state={...state,preparedOperation:{operationId:'op-j01',operationType:'reserve',operationFingerprint:'op-fp',dependencyFingerprint:reserve.preconditionFingerprint,dependencyKeys:['requestedStay.checkIn','requestedStay.checkOut','availability','groundedSelection','operationIntent'],canonicalInputSnapshot:reserve.groundedInput,status:'approval_required'}};
  assert.deepEqual(planner.plan(context(state)),{kind:'WAIT',reason:'approval_pending',correlationId:'op-j01'});
  state={...state,preparedOperation:{...state.preparedOperation,status:'approved'}};
  assert.deepEqual(planner.plan(context(state)),{kind:'WAIT',reason:'external_event',correlationId:'op-j01'});
  state={...state,execution:{status:'executing',operationId:'op-j01',operationFingerprint:'op-fp',dependencyFingerprint:reserve.preconditionFingerprint}};
  assert.deepEqual(planner.plan(context(state)),{kind:'WAIT',reason:'external_event',correlationId:'op-j01'});
  state={...state,bookings:[{bookingId:'B-J01',observationRevision:2}],execution:{status:'confirmed',operationId:'op-j01',operationFingerprint:'op-fp',dependencyFingerprint:reserve.preconditionFingerprint,outcomeKind:'booking_created'}};
  const done=planner.plan(context(state)); assert.equal(done.kind,'COMPLETE'); assert.equal(done.completionReason,'booking_created');
});
