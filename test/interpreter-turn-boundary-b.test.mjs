import test from 'node:test';
import { assert, fact, turn, completeStay, observedState, groundedState, approvalState } from './interpreter-turn-boundary-fixture.mjs';

test('relation other requires two grounded anchored options',()=>{
  const r=turn(observedState(),{classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'relation',relation:'other',scope:'observation_scoped'}}}},
    {dialogueAnchor:{kind:'selection',presentedEntities:[{entityType:'room',ordinal:1,roomNumber:'101'},{entityType:'room',ordinal:2,roomNumber:'102'}],focusedEntity:{entityType:'room',ordinal:1,roomNumber:'101'}}});
  assert.deepEqual(r.nextState.groundedSelection.roomIds,['r102']);
});

test('descriptive selection asks instead of inventing operational truth',()=>{
  const r=turn(observedState(),{classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'descriptive_preference',value:'la más linda',scope:'entity_scoped'}}}});
  assert.equal(r.nextState.groundedSelection.status,'none'); assert.equal(r.nextStep.kind,'ASK'); assert.equal(r.nextStep.reason,'DESCRIPTIVE_SELECTION_REQUIRES_EXPLICIT_GROUNDING');
});

test('compare_price and booking_lookup do not create hidden tool workflows',()=>{
  for (const kind of ['compare_price','booking_lookup']) { const r=turn(completeStay(),{classification:'task',directives:{readRequest:{kind}}}); assert.equal(r.nextStep.kind,'DEGRADE'); }
});

test('current-operation retry remains control-plane owned',()=>{
  const r=turn(completeStay(),{classification:'task',directives:{retry:{target:'current_operation'}}}); assert.equal(r.nextStep.reasonCode,'WRITE_RETRY_NOT_PLANNER_OWNED');
});

test('social during approval pending never advances write',()=>{
  const r=turn(approvalState(),{classification:'social',directives:{interaction:'social'}}); assert.equal(r.nextStep.responseIntent,'social'); assert.equal(r.nextState.preparedOperation.status,'approval_required');
});

test('maxInternalSteps is finite',()=>{
  const r=turn(observedState(),{classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:1,scope:'observation_scoped'}}}},{maxInternalSteps:2});
  assert.equal(r.ok,false); assert.equal(r.failureCode,'MAX_INTERNAL_STEPS_EXCEEDED');
});

test('abort during admitted execution is too late and preserves intent',()=>{
  const approved=approvalState(); const state={...approved,preparedOperation:{...approved.preparedOperation,status:'approved'},execution:{status:'executing',operationId:'op1',operationFingerprint:'ofp',dependencyFingerprint:approved.preparedOperation.dependencyFingerprint}};
  const r=turn(state,{classification:'task',directives:{abortCurrentOperation:true}}); assert.deepEqual(r.appliedEventIds,[]); assert.equal(r.nextState.operationIntent.kind,'reserve'); assert.equal(r.nextStep.reasonCode,'ABORT_TOO_LATE_EXECUTION_COMMITTED');
});

test('new selection cannot diverge from persistent reserve target',()=>{
  const state={...groundedState(),requestedSelectionReference:fact({kind:'ordinal',ordinal:1,scope:'observation_scoped'}),operationIntent:{kind:'reserve',status:'active',targetSemanticReference:{kind:'ordinal',ordinal:1,scope:'observation_scoped'},provenance:{source:'user',revision:7}}};
  const r=turn(state,{classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:2,scope:'observation_scoped'}}}}); assert.equal(r.ok,false); assert.equal(r.failureCode,'CONFLICTING_SELECTION_REFERENCES');
});

test('weak anchor cannot fall back to internal HMS order',()=>{
  const r=turn(groundedState(2),{classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:1,scope:'observation_scoped'}}}},
    {dialogueAnchor:{kind:'selection',presentedEntities:[{entityType:'room',ordinal:1,label:'primera opción'}]}});
  assert.equal(r.nextState.groundedSelection.status,'stale'); assert.equal(r.nextStep.kind,'ASK'); assert.equal(r.nextStep.reason,'ORDINAL_OUT_OF_RANGE');
});
