import test from 'node:test';
import { assert, planner, fact, baseState, turn, completeStay, plannerContext, observeAvailability, observedState, groundedState, approvalState, reduceTaskState, HOTEL_TASK_DEFINITION_V1 } from './interpreter-turn-boundary-fixture.mjs';

test('J01 offline preserves validate-reduce-ground-plan order',()=>{
  let state=baseState();
  let r=turn(state,{classification:'task',taskSemanticChanges:{requestedGoal:{op:'set',value:'reservation'}}}); assert.equal(r.nextStep.field,'dates'); state=r.nextState;
  r=turn(state,{classification:'task',taskSemanticChanges:{checkIn:{op:'set',value:'2027-01-15'},checkOut:{op:'set',value:'2027-01-17'}}}); assert.equal(r.nextStep.field,'guests'); state=r.nextState;
  r=turn(state,{classification:'task',taskSemanticChanges:{guests:{op:'set',value:2}}}); assert.equal(r.nextStep.capabilityId,'availability'); state=observeAvailability(r.nextState);
  r=turn(state,{classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:2,scope:'observation_scoped'}}}});
  assert.deepEqual(r.nextState.groundedSelection.roomIds,['r102']); assert.equal(r.nextStep.responseIntent,'selection_acknowledged'); state=r.nextState;
  r=turn(state,{classification:'task',taskSemanticChanges:{operationIntent:{op:'set',value:{kind:'reserve',status:'active'}}}});
  assert.equal(r.nextStep.kind,'CALL_TOOL'); assert.equal(r.nextStep.capabilityId,'reserve_single'); assert.equal(r.nextStep.groundedInput.roomId,'r102');
});

test('unknown turn cannot continue an existing mutation',()=>{
  const r=turn({...groundedState(),operationIntent:{kind:'reserve',status:'active',provenance:{source:'user',revision:8}}},{classification:'unknown'});
  assert.equal(r.nextStep.kind,'DEGRADE'); assert.equal(r.nextStep.reasonCode,'UNINTERPRETABLE_USER_TURN');
});

test('ambiguity is ephemeral bounded ASK',()=>{
  const state=completeStay(); const r=turn(state,{classification:'task',taskSemanticChanges:{ambiguity:{topic:'dates',reasonCode:'DATE_AMBIGUOUS'}}});
  assert.deepEqual(r.appliedEventIds,[]); assert.equal(r.nextState.stateRevision,state.stateRevision); assert.equal(r.nextStep.field,'dates');
});

test('abort clears intent and invalidates pending approval before acknowledgement',()=>{
  const r=turn(approvalState(),{classification:'task',directives:{abortCurrentOperation:true}});
  assert.equal(r.nextState.operationIntent,undefined); assert.equal(r.nextState.preparedOperation.status,'invalidated'); assert.equal(r.nextStep.responseIntent,'operation_aborted');
});

test('abort plus new operation intent fails closed',()=>{
  const state=completeStay(); const r=turn(state,{classification:'task',taskSemanticChanges:{operationIntent:{op:'set',value:{kind:'reserve',status:'active'}}},directives:{abortCurrentOperation:true}});
  assert.equal(r.ok,false); assert.equal(r.failureCode,'ABORT_CONTRADICTS_OPERATION_INTENT_SET'); assert.equal(r.nextState.stateRevision,state.stateRevision);
});

test('withdrawing commit invalidates approval before quote read',()=>{
  const r=turn(approvalState(),{classification:'task',taskSemanticChanges:{operationIntent:{op:'clear'}},directives:{readRequest:{kind:'quote'}}});
  assert.equal(r.nextState.preparedOperation.status,'invalidated'); assert.equal(r.nextStep.capabilityId,'quote');
});

test('correction supersedes pending availability before replanning',()=>{
  const state=completeStay(); const call=planner.plan(plannerContext(state));
  const pending=reduceTaskState(state,{kind:'tool_invocation_started',eventId:'pending-old',taskId:state.taskId,sessionId:state.sessionId,expectedStateRevision:state.stateRevision,
    invocationId:'old-inv',capabilityId:'availability',dependencyFingerprint:call.preconditionFingerprint,dependencyKeys:HOTEL_TASK_DEFINITION_V1.capabilities.availability.dependencyKeys,inputSnapshot:call.groundedInput,startedAt:'x'}).nextState;
  const r=turn(pending,{classification:'task',taskSemanticChanges:{checkIn:{op:'set',value:'2027-01-16'},checkOut:{op:'set',value:'2027-01-18'}}});
  assert.equal(r.nextState.pendingToolInvocation.status,'superseded'); assert.equal(r.nextStep.capabilityId,'availability'); assert.notEqual(r.nextStep.preconditionFingerprint,call.preconditionFingerprint);
});

test('reserve target can be server-grounded before write proposal',()=>{
  const r=turn(observedState(),{classification:'task',taskSemanticChanges:{operationIntent:{op:'set',value:{kind:'reserve',status:'active',targetSemanticReference:{kind:'ordinal',ordinal:2,scope:'observation_scoped'}}}}});
  assert.deepEqual(r.nextState.groundedSelection.roomIds,['r102']); assert.ok(r.nextState.groundedSelection.dependencyKeys.includes('operationIntent')); assert.equal(r.nextStep.groundedInput.roomId,'r102');
});

test('conflicting selection and mutation target fail closed',()=>{
  const r=turn(observedState(),{classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:1,scope:'observation_scoped'}},operationIntent:{op:'set',value:{kind:'reserve',status:'active',targetSemanticReference:{kind:'ordinal',ordinal:2,scope:'observation_scoped'}}}}});
  assert.equal(r.ok,false); assert.equal(r.failureCode,'CONFLICTING_SELECTION_REFERENCES');
});

test('ordinal grounding follows DialogueAnchor presentation',()=>{
  const r=turn(observedState(),{classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:1,scope:'observation_scoped'}}}},
    {dialogueAnchor:{kind:'selection',presentedEntities:[{entityType:'room',ordinal:1,roomNumber:'102'},{entityType:'room',ordinal:2,roomNumber:'101'}]}});
  assert.deepEqual(r.nextState.groundedSelection.roomIds,['r102']);
});
