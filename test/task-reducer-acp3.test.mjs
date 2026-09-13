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
    quote:{status:'not_queried', roomIds:[], dependencyKeys:[]},
    groundedSelection:{status:'none', roomIds:[], dependencyKeys:[]}, bookings:[], execution:{status:'not_started'},
  };
}

function eventBase(eventId) { return { eventId, taskId:'task-1', sessionId:'session-1' }; }

test('set/clear/noChange updates requested semantics without re-invalidating equal values', () => {
  let s = emptyState();
  let r = reduceTaskState(s, { ...eventBase('e1'), expectedStateRevision:0, kind:'user_semantic', sourceRevision:1, patch:{ checkIn:{op:'set',value:'2027-01-15'}, guests:{op:'set',value:2} } });
  assert.equal(r.accepted,true); assert.equal(r.nextState.stateRevision,1); assert.equal(r.nextState.requestedStay.guests.value,2);
  s = r.nextState;
  r = reduceTaskState(s, { ...eventBase('e2'), expectedStateRevision:1, kind:'user_semantic', sourceRevision:2, patch:{ checkIn:{op:'set',value:'2027-01-15'} } });
  assert.equal(r.materialChange,false); assert.equal(r.nextState.stateRevision,1);
  r = reduceTaskState(r.nextState, { ...eventBase('e3'), expectedStateRevision:1, kind:'user_semantic', sourceRevision:3, patch:{ guests:{op:'clear'} } });
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
  const r = reduceTaskState(base, { ...eventBase('e4'), expectedStateRevision:0, kind:'user_semantic', sourceRevision:2, patch:{ checkIn:{op:'set',value:'2027-01-16'} } });
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
  const r = reduceTaskState(base,{...eventBase('e5'),expectedStateRevision:0,kind:'user_semantic',sourceRevision:2,patch:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:2,scope:'observation_scoped'}}}});
  assert.equal(r.nextState.availability.status,'observed');
  assert.equal(r.nextState.groundedSelection.status,'stale');
  assert.equal(r.nextState.preparedOperation.status,'invalidated');
  assert.ok(!r.invalidations.includes('availability'));
});

test('stale availability result cannot be promoted after dependency supersession', () => {
  let s = emptyState();
  let r = reduceTaskState(s,{...eventBase('start'),expectedStateRevision:0,kind:'tool_invocation_started',invocationId:'inv1',capabilityId:'availability',dependencyFingerprint:'fp-old',dependencyKeys:stayDeps,inputSnapshot:{checkIn:'2027-01-15'},startedAt:'2026-09-13T00:00:00Z'});
  s = r.nextState;
  r = reduceTaskState(s,{...eventBase('corr'),expectedStateRevision:1,kind:'user_semantic',sourceRevision:1,patch:{checkIn:{op:'set',value:'2027-01-16'}}});
  s = r.nextState;
  assert.equal(s.pendingToolInvocation.status,'superseded');
  r = reduceTaskState(s,{...eventBase('obs-old'),kind:'availability_observed',invocationId:'inv1',dependencyFingerprint:'fp-old',observationRevision:1,rooms:[{roomId:'r101'}],observedAt:'2026-09-13T00:00:01Z'});
  assert.equal(r.accepted,false); assert.equal(r.rejectionReason,'STALE_DEPENDENCY'); assert.equal(r.nextState.availability.status,'not_queried');
});

test('availability failure preserves requested semantics and never auto-retries', () => {
  let s = emptyState();
  s.requestedStay = {guests:{value:2,provenance:{source:'user',revision:1}}};
  let r = reduceTaskState(s,{...eventBase('start2'),expectedStateRevision:0,kind:'tool_invocation_started',invocationId:'inv2',capabilityId:'availability',dependencyFingerprint:'fp2',dependencyKeys:['requestedStay.guests'],inputSnapshot:{guests:2},startedAt:'2026-09-13T00:00:00Z'});
  r = reduceTaskState(r.nextState,{...eventBase('fail2'),kind:'availability_failed',invocationId:'inv2',dependencyFingerprint:'fp2'});
  assert.equal(r.nextState.availability.status,'failed'); assert.equal(r.nextState.requestedStay.guests.value,2); assert.equal(r.nextState.pendingToolInvocation.status,'failed');
});

test('server grounding must target rooms from the exact current availability observation', () => {
  const s = emptyState();
  s.availability = {status:'observed',observationRevision:7,dependencyFingerprint:'fp7',dependencyKeys:stayDeps,rooms:[{roomId:'r101'}]};
  const bad = reduceTaskState(s,{...eventBase('g1'),expectedStateRevision:0,kind:'selection_grounded',roomIds:['r999'],basedOnAvailabilityRevision:7,dependencyFingerprint:'gfp',dependencyKeys:selectionDeps});
  assert.equal(bad.accepted,false); assert.equal(bad.rejectionReason,'INVALID_GROUNDING');
  const good = reduceTaskState(s,{...eventBase('g2'),expectedStateRevision:0,kind:'selection_grounded',roomIds:['r101'],basedOnAvailabilityRevision:7,dependencyFingerprint:'gfp',dependencyKeys:selectionDeps});
  assert.equal(good.accepted,true); assert.equal(good.nextState.groundedSelection.status,'grounded');
});

test('replayed event is bounded and does not advance revision twice', () => {
  const s = emptyState();
  const e = {...eventBase('dup'),expectedStateRevision:0,kind:'user_semantic',sourceRevision:1,patch:{guests:{op:'set',value:2}}};
  const first = reduceTaskState(s,e); const second = reduceTaskState(first.nextState,e);
  assert.equal(second.replayed,true); assert.equal(second.materialChange,false); assert.equal(second.nextState.stateRevision,first.nextState.stateRevision);
});

test('revision-guarded user/server events fail closed on optimistic concurrency conflict', () => {
  const s = emptyState();
  s.stateRevision = 3;
  const r = reduceTaskState(s,{...eventBase('conflict'),expectedStateRevision:2,kind:'user_semantic',sourceRevision:4,patch:{guests:{op:'set',value:2}}});
  assert.equal(r.accepted,false);
  assert.equal(r.rejectionReason,'STATE_REVISION_CONFLICT');
  assert.equal(r.nextState.requestedStay.guests,undefined);
  assert.equal(r.nextState.stateRevision,3);
});

test('tool observation may promote after unrelated revision change when dependency fingerprint is still current', () => {
  let s = emptyState();
  let r = reduceTaskState(s,{...eventBase('start-unrelated'),expectedStateRevision:0,kind:'tool_invocation_started',invocationId:'inv-u',capabilityId:'availability',dependencyFingerprint:'fp-u',dependencyKeys:stayDeps,inputSnapshot:{checkIn:'2027-01-15'},startedAt:'2026-09-13T00:00:00Z'});
  s = r.nextState;
  r = reduceTaskState(s,{...eventBase('pref'),expectedStateRevision:1,kind:'user_semantic',sourceRevision:1,patch:{preferences:{op:'set',value:['cama doble']}}});
  s = r.nextState;
  assert.equal(s.stateRevision,2);
  assert.equal(s.pendingToolInvocation.status,'pending');
  r = reduceTaskState(s,{...eventBase('obs-u'),kind:'availability_observed',invocationId:'inv-u',dependencyFingerprint:'fp-u',observationRevision:9,rooms:[{roomId:'r101'}],observedAt:'2026-09-13T00:00:01Z'});
  assert.equal(r.accepted,true);
  assert.equal(r.nextState.availability.status,'observed');
  assert.equal(r.nextState.availability.rooms[0].roomId,'r101');
});

test('starting a new availability observation stales grounding and invalidates prepared operation that depended on old availability', () => {
  const s = emptyState();
  s.availability = {status:'observed',observationRevision:4,dependencyFingerprint:'old-a',dependencyKeys:stayDeps,rooms:[{roomId:'r101'}]};
  s.groundedSelection = {status:'grounded',roomIds:['r101'],basedOnAvailabilityRevision:4,dependencyFingerprint:'old-s',dependencyKeys:selectionDeps};
  s.preparedOperation = {operationId:'op-old',operationType:'reserve',operationFingerprint:'opf-old',dependencyFingerprint:'dep-old',dependencyKeys:writeDeps,canonicalInputSnapshot:{},status:'approval_required'};
  const r = reduceTaskState(s,{...eventBase('refresh'),expectedStateRevision:0,kind:'tool_invocation_started',invocationId:'inv-new',capabilityId:'availability',dependencyFingerprint:'new-a',dependencyKeys:stayDeps,inputSnapshot:{},startedAt:'2026-09-13T00:00:00Z'});
  assert.equal(r.nextState.availability.status,'pending');
  assert.equal(r.nextState.groundedSelection.status,'stale');
  assert.equal(r.nextState.preparedOperation.status,'invalidated');
});

test('terminal task rejects later mutation events and terminal transition supersedes pending work', () => {
  const s = emptyState();
  s.pendingToolInvocation = {invocationId:'inv-t',capabilityId:'availability',status:'pending',dependencyFingerprint:'fp-t',dependencyKeys:stayDeps,inputSnapshot:{},startedAt:'2026-09-13T00:00:00Z'};
  s.preparedOperation = {operationId:'op-t',operationType:'reserve',operationFingerprint:'opf-t',dependencyFingerprint:'dep-t',dependencyKeys:writeDeps,canonicalInputSnapshot:{},status:'approval_required'};
  const closed = reduceTaskState(s,{...eventBase('close'),expectedStateRevision:0,kind:'lifecycle_changed',lifecycle:'completed'});
  assert.equal(closed.accepted,true);
  assert.equal(closed.nextState.lifecycle,'completed');
  assert.equal(closed.nextState.pendingToolInvocation.status,'superseded');
  assert.equal(closed.nextState.preparedOperation.status,'invalidated');
  const late = reduceTaskState(closed.nextState,{...eventBase('late'),expectedStateRevision:1,kind:'user_semantic',sourceRevision:2,patch:{guests:{op:'set',value:3}}});
  assert.equal(late.accepted,false);
  assert.equal(late.rejectionReason,'TASK_NOT_ACTIVE');
});

test('quote observation uses the same causal invocation boundary and preserves requested semantics on failure', () => {
  let s = emptyState();
  s.requestedStay = {checkIn:{value:'2027-01-15',provenance:{source:'user',revision:1}}};
  let r = reduceTaskState(s,{...eventBase('q-start'),expectedStateRevision:0,kind:'tool_invocation_started',invocationId:'q-inv',capabilityId:'quote',dependencyFingerprint:'q-fp',dependencyKeys:['requestedStay.checkIn','groundedSelection'],inputSnapshot:{roomId:'r101'},startedAt:'2026-09-13T00:00:00Z'});
  r = reduceTaskState(r.nextState,{...eventBase('q-ok'),kind:'quote_observed',invocationId:'q-inv',dependencyFingerprint:'q-fp',observationRevision:2,roomIds:['r101'],amountCents:50000,currency:'ARS',observedAt:'2026-09-13T00:00:01Z'});
  assert.equal(r.accepted,true);
  assert.equal(r.nextState.quote.status,'observed');
  assert.equal(r.nextState.quote.amountCents,50000);
  assert.equal(r.nextState.requestedStay.checkIn.value,'2027-01-15');
});

test('approval can only advance the exact prepared operation and execution requires prepared or approved status', () => {
  let s = emptyState();
  const operation = {operationId:'op1',operationType:'reserve',operationFingerprint:'opf1',dependencyFingerprint:'depf1',dependencyKeys:writeDeps,canonicalInputSnapshot:{roomId:'r101'},status:'approval_required'};
  let r = reduceTaskState(s,{...eventBase('prep'),expectedStateRevision:0,kind:'operation_prepared',operation});
  assert.equal(r.nextState.preparedOperation.status,'approval_required');
  const wrong = reduceTaskState(r.nextState,{...eventBase('approve-wrong'),expectedStateRevision:1,kind:'approval_state_changed',operationId:'op1',operationFingerprint:'other',dependencyFingerprint:'depf1',status:'approved'});
  assert.equal(wrong.accepted,false);
  assert.equal(wrong.rejectionReason,'OPERATION_BINDING_MISMATCH');
  r = reduceTaskState(r.nextState,{...eventBase('approve'),expectedStateRevision:1,kind:'approval_state_changed',operationId:'op1',operationFingerprint:'opf1',dependencyFingerprint:'depf1',status:'approved'});
  assert.equal(r.nextState.preparedOperation.status,'approved');
  r = reduceTaskState(r.nextState,{...eventBase('exec'),expectedStateRevision:2,kind:'execution_started',operationId:'op1',operationFingerprint:'opf1',dependencyFingerprint:'depf1'});
  assert.equal(r.nextState.execution.status,'executing');
});

test('J01 write outcome is accepted only for the exact executing operation and produces tool-authoritative booking truth', () => {
  let s = emptyState();
  const operation = {operationId:'op1',operationType:'reserve',operationFingerprint:'opf1',dependencyFingerprint:'depf1',dependencyKeys:writeDeps,canonicalInputSnapshot:{roomId:'r101'},status:'prepared'};
  let r = reduceTaskState(s,{...eventBase('prep-auto'),expectedStateRevision:0,kind:'operation_prepared',operation});
  r = reduceTaskState(r.nextState,{...eventBase('exec-auto'),expectedStateRevision:1,kind:'execution_started',operationId:'op1',operationFingerprint:'opf1',dependencyFingerprint:'depf1'});
  const stale = reduceTaskState(r.nextState,{...eventBase('booking-wrong'),kind:'booking_created',operationId:'op1',operationFingerprint:'wrong',dependencyFingerprint:'depf1',booking:{bookingId:'BK-X',status:'confirmed',roomIds:['r101'],observationRevision:1}});
  assert.equal(stale.accepted,false);
  assert.equal(stale.rejectionReason,'OPERATION_BINDING_MISMATCH');
  r = reduceTaskState(r.nextState,{...eventBase('booking-ok'),kind:'booking_created',operationId:'op1',operationFingerprint:'opf1',dependencyFingerprint:'depf1',booking:{bookingId:'BK-123',status:'confirmed',roomIds:['r101'],observationRevision:1}});
  assert.equal(r.accepted,true);
  assert.equal(r.nextState.execution.status,'confirmed');
  assert.equal(r.nextState.execution.outcomeKind,'booking_created');
  assert.equal(r.nextState.bookings[0].bookingId,'BK-123');
});

test('once execution has started, dependent user mutation cannot rewrite the committed operation task', () => {
  const s = emptyState();
  s.preparedOperation = {operationId:'op1',operationType:'reserve',operationFingerprint:'opf1',dependencyFingerprint:'depf1',dependencyKeys:writeDeps,canonicalInputSnapshot:{},status:'approved'};
  s.execution = {status:'executing',operationId:'op1',operationFingerprint:'opf1',dependencyFingerprint:'depf1'};
  const r = reduceTaskState(s,{...eventBase('too-late'),expectedStateRevision:0,kind:'user_semantic',sourceRevision:2,patch:{checkIn:{op:'set',value:'2027-01-20'}}});
  assert.equal(r.accepted,false);
  assert.equal(r.rejectionReason,'EXECUTION_ALREADY_COMMITTED');
  const confirmed = emptyState();
  confirmed.execution = {status:'confirmed',operationId:'op1',operationFingerprint:'opf1',dependencyFingerprint:'depf1',outcomeKind:'booking_created'};
  const afterConfirmed = reduceTaskState(confirmed,{...eventBase('too-late-confirmed'),expectedStateRevision:0,kind:'user_semantic',sourceRevision:3,patch:{guests:{op:'set',value:3}}});
  assert.equal(afterConfirmed.accepted,false);
  assert.equal(afterConfirmed.rejectionReason,'EXECUTION_ALREADY_COMMITTED');
});

test('execution failure is operational truth and does not erase requested semantics', () => {
  const s = emptyState();
  s.requestedStay = {guests:{value:2,provenance:{source:'user',revision:1}}};
  s.preparedOperation = {operationId:'op1',operationType:'reserve',operationFingerprint:'opf1',dependencyFingerprint:'depf1',dependencyKeys:writeDeps,canonicalInputSnapshot:{},status:'approved'};
  s.execution = {status:'executing',operationId:'op1',operationFingerprint:'opf1',dependencyFingerprint:'depf1'};
  const r = reduceTaskState(s,{...eventBase('exec-fail'),kind:'operation_execution_failed',operationId:'op1',operationFingerprint:'opf1',dependencyFingerprint:'depf1',failureCode:'HMS_TIMEOUT'});
  assert.equal(r.accepted,true);
  assert.equal(r.nextState.execution.status,'failed');
  assert.equal(r.nextState.requestedStay.guests.value,2);
});
