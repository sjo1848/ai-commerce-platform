import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceTaskState } from '../dist/core/task-reducer.js';

const stayDeps = ['requestedStay.checkIn','requestedStay.checkOut','requestedStay.guests'];
const selectionDeps = [...stayDeps, 'availability', 'requestedSelectionReference'];
const writeDeps = [...selectionDeps, 'groundedSelection', 'operationIntent'];

function emptyState() {
  return {
    taskId:'task-1', sessionId:'session-1', taskType:'hotel_reservation_domain', lifecycle:'active',
    stateRevision:0, recentEventIds:[], requestedStay:{}, preferences:[],
    availability:{status:'not_queried', rooms:[], dependencyKeys:[]},
    groundedSelection:{status:'none', roomIds:[], dependencyKeys:[]}, bookings:[],
  };
}

function eventBase(eventId) { return { eventId, taskId:'task-1', sessionId:'session-1' }; }

test('set/clear/noChange updates requested semantics without re-invalidating equal values', () => {
  let s = emptyState();
  let r = reduceTaskState(s, { ...eventBase('e1'), kind:'user_semantic', sourceRevision:1, patch:{ checkIn:{op:'set',value:'2027-01-15'}, guests:{op:'set',value:2} } });
  assert.equal(r.accepted,true); assert.equal(r.nextState.stateRevision,1); assert.equal(r.nextState.requestedStay.guests.value,2);
  s = r.nextState;
  r = reduceTaskState(s, { ...eventBase('e2'), kind:'user_semantic', sourceRevision:2, patch:{ checkIn:{op:'set',value:'2027-01-15'} } });
  assert.equal(r.materialChange,false); assert.equal(r.nextState.stateRevision,1);
  r = reduceTaskState(r.nextState, { ...eventBase('e3'), kind:'user_semantic', sourceRevision:3, patch:{ guests:{op:'clear'} } });
  assert.equal(r.materialChange,true); assert.equal(r.nextState.requestedStay.guests,undefined); assert.equal(r.nextState.stateRevision,2);
});

test('stay correction invalidates only dependent operational state and supersedes matching pending work', () => {
  const base = emptyState();
  base.requestedStay = {
    checkIn:{value:'2027-01-15',provenance:{source:'user',revision:1}},
    checkOut:{value:'2027-01-17',provenance:{source:'user',revision:1}},
    guests:{value:2,provenance:{source:'user',revision:1}},
  };
  base.availability = {status:'observed', observationRevision:4, dependencyFingerprint:'stay-A', dependencyKeys:stayDeps, rooms:[{roomId:'r101'}]};
  base.groundedSelection = {status:'grounded',roomIds:['r101'],basedOnAvailabilityRevision:4,dependencyFingerprint:'sel-A',dependencyKeys:selectionDeps};
  base.pendingToolInvocation = {invocationId:'q1',capabilityId:'availability',status:'pending',dependencyFingerprint:'stay-A',dependencyKeys:stayDeps,inputSnapshot:{},startedAt:'2026-09-13T00:00:00Z'};
  base.preparedOperation = {operationId:'op1',operationType:'reserve',operationFingerprint:'op-A',dependencyFingerprint:'write-A',dependencyKeys:writeDeps,canonicalInputSnapshot:{},status:'approval_required'};
  const r = reduceTaskState(base, { ...eventBase('e4'), kind:'user_semantic', sourceRevision:2, patch:{ checkIn:{op:'set',value:'2027-01-16'} } });
  assert.equal(r.nextState.availability.status,'not_queried');
  assert.equal(r.nextState.groundedSelection.status,'stale');
  assert.equal(r.nextState.pendingToolInvocation.status,'superseded');
  assert.equal(r.nextState.preparedOperation.status,'invalidated');
  assert.deepEqual(new Set(r.invalidations), new Set(['availability','grounded_selection','pending_tool_invocation','prepared_operation']));
});

test('selection correction preserves compatible availability while invalidating selection/write', () => {
  const base = emptyState();
  base.availability = {status:'observed',observationRevision:5,dependencyFingerprint:'stay-A',dependencyKeys:stayDeps,rooms:[{roomId:'r101'},{roomId:'r102'}]};
  base.requestedSelectionReference = {value:{kind:'ordinal',ordinal:1,scope:'observation_scoped'},provenance:{source:'user',revision:1}};
  base.groundedSelection = {status:'grounded',roomIds:['r101'],basedOnAvailabilityRevision:5,dependencyFingerprint:'sel-A',dependencyKeys:selectionDeps};
  base.preparedOperation = {operationId:'op1',operationType:'reserve',operationFingerprint:'op-A',dependencyFingerprint:'write-A',dependencyKeys:writeDeps,canonicalInputSnapshot:{},status:'approval_required'};
  const r = reduceTaskState(base,{...eventBase('e5'),kind:'user_semantic',sourceRevision:2,patch:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:2,scope:'observation_scoped'}}}});
  assert.equal(r.nextState.availability.status,'observed');
  assert.equal(r.nextState.groundedSelection.status,'stale');
  assert.equal(r.nextState.preparedOperation.status,'invalidated');
  assert.ok(!r.invalidations.includes('availability'));
});

test('stale availability result cannot be promoted after dependency supersession', () => {
  let s = emptyState();
  let r = reduceTaskState(s,{...eventBase('start'),kind:'tool_invocation_started',invocationId:'inv1',capabilityId:'availability',dependencyFingerprint:'fp-old',dependencyKeys:stayDeps,inputSnapshot:{checkIn:'2027-01-15'},startedAt:'2026-09-13T00:00:00Z'});
  s = r.nextState;
  r = reduceTaskState(s,{...eventBase('corr'),kind:'user_semantic',sourceRevision:1,patch:{checkIn:{op:'set',value:'2027-01-16'}}});
  s = r.nextState;
  assert.equal(s.pendingToolInvocation.status,'superseded');
  r = reduceTaskState(s,{...eventBase('obs-old'),kind:'availability_observed',invocationId:'inv1',dependencyFingerprint:'fp-old',observationRevision:1,rooms:[{roomId:'r101'}],observedAt:'2026-09-13T00:00:01Z'});
  assert.equal(r.accepted,false); assert.equal(r.rejectionReason,'STALE_DEPENDENCY'); assert.equal(r.nextState.availability.status,'not_queried');
});

test('availability failure preserves requested semantics and never auto-retries', () => {
  let s = emptyState();
  s.requestedStay = {guests:{value:2,provenance:{source:'user',revision:1}}};
  let r = reduceTaskState(s,{...eventBase('start2'),kind:'tool_invocation_started',invocationId:'inv2',capabilityId:'availability',dependencyFingerprint:'fp2',dependencyKeys:['requestedStay.guests'],inputSnapshot:{guests:2},startedAt:'2026-09-13T00:00:00Z'});
  r = reduceTaskState(r.nextState,{...eventBase('fail2'),kind:'availability_failed',invocationId:'inv2',dependencyFingerprint:'fp2'});
  assert.equal(r.nextState.availability.status,'failed'); assert.equal(r.nextState.requestedStay.guests.value,2); assert.equal(r.nextState.pendingToolInvocation.status,'failed');
});

test('server grounding must target rooms from the exact current availability observation', () => {
  const s = emptyState();
  s.availability = {status:'observed',observationRevision:7,dependencyFingerprint:'fp7',dependencyKeys:stayDeps,rooms:[{roomId:'r101'}]};
  const bad = reduceTaskState(s,{...eventBase('g1'),kind:'selection_grounded',roomIds:['r999'],basedOnAvailabilityRevision:7,dependencyFingerprint:'gfp',dependencyKeys:selectionDeps});
  assert.equal(bad.accepted,false); assert.equal(bad.rejectionReason,'INVALID_GROUNDING');
  const good = reduceTaskState(s,{...eventBase('g2'),kind:'selection_grounded',roomIds:['r101'],basedOnAvailabilityRevision:7,dependencyFingerprint:'gfp',dependencyKeys:selectionDeps});
  assert.equal(good.accepted,true); assert.equal(good.nextState.groundedSelection.status,'grounded');
});

test('replayed event is bounded and does not advance revision twice', () => {
  const s = emptyState();
  const e = {...eventBase('dup'),kind:'user_semantic',sourceRevision:1,patch:{guests:{op:'set',value:2}}};
  const first = reduceTaskState(s,e); const second = reduceTaskState(first.nextState,e);
  assert.equal(second.replayed,true); assert.equal(second.materialChange,false); assert.equal(second.nextState.stateRevision,first.nextState.stateRevision);
});
