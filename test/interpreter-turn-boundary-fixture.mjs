import assert from 'node:assert/strict';
import { applyInterpreterTurnToPlanner } from '../dist/core/interpreter-turn-boundary.js';
import { HotelTaskPlanner } from '../dist/core/hotel-task-planner.js';
import { HOTEL_TASK_DEFINITION_V1, buildHotelDomainCapabilities } from '../dist/core/planning.js';
import { reduceTaskState } from '../dist/core/task-reducer.js';

export { assert, reduceTaskState, HOTEL_TASK_DEFINITION_V1 };
export const planner = new HotelTaskPlanner();
export const caps = buildHotelDomainCapabilities([
  'hms.checkAvailability','hms.getQuote','hms.createReservation','hms.createMultiReservation',
  'hms.cancelReservation','hms.cancelMultiReservation'
]);
export const fact = (value, revision=1) => ({value,provenance:{source:'user',revision}});
export function baseState(overrides={}) { return {
  taskId:'t1',sessionId:'s1',taskType:'hotel_reservation_domain',lifecycle:'active',stateRevision:1,recentEventIds:[],
  requestedStay:{},preferences:[],availability:{status:'not_queried',rooms:[],dependencyKeys:[]},
  quote:{status:'not_queried',roomIds:[],dependencyKeys:[]},groundedSelection:{status:'none',roomIds:[],dependencyKeys:[]},
  bookings:[],execution:{status:'not_started'},...overrides
}; }
let seq=0;
export function turn(state, output, extraMeta={}) {
  seq += 1;
  return applyInterpreterTurnToPlanner({state,output,planner,taskDefinition:HOTEL_TASK_DEFINITION_V1,capabilities:caps,
    meta:{eventId:`u${seq}`,sourceRevision:seq,...extraMeta}});
}
export function completeStay(extra={}) { return baseState({requestedGoal:fact('reservation'),
  requestedStay:{checkIn:fact('2027-01-15'),checkOut:fact('2027-01-17'),guests:fact(2)},...extra}); }
export function plannerContext(state, trigger={origin:'server'}) { return {state,trigger,taskDefinition:HOTEL_TASK_DEFINITION_V1,capabilities:caps}; }
export function observeAvailability(state, rooms=[{roomId:'r101',roomNumber:'101'},{roomId:'r102',roomNumber:'102'}]) {
  const call=planner.plan(plannerContext(state)); assert.equal(call.kind,'CALL_TOOL'); assert.equal(call.capabilityId,'availability');
  const invocationId=`inv-${++seq}`;
  const started=reduceTaskState(state,{kind:'tool_invocation_started',eventId:`start-${seq}`,taskId:state.taskId,sessionId:state.sessionId,
    expectedStateRevision:state.stateRevision,invocationId,capabilityId:'availability',dependencyFingerprint:call.preconditionFingerprint,
    dependencyKeys:HOTEL_TASK_DEFINITION_V1.capabilities.availability.dependencyKeys,inputSnapshot:call.groundedInput,startedAt:'2026-09-13T12:00:00Z'});
  assert.equal(started.accepted,true);
  const observed=reduceTaskState(started.nextState,{kind:'availability_observed',eventId:`obs-${++seq}`,taskId:state.taskId,sessionId:state.sessionId,
    invocationId,dependencyFingerprint:call.preconditionFingerprint,observationRevision:20+seq,rooms,observedAt:'2026-09-13T12:00:01Z'});
  assert.equal(observed.accepted,true); return observed.nextState;
}
export function observedState() { return observeAvailability(completeStay()); }
export function groundedState(roomOrdinal=1) {
  const result=turn(observedState(),{classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:roomOrdinal,scope:'observation_scoped'}}}});
  assert.equal(result.ok,true); return result.nextState;
}
export function approvalState() {
  const state={...groundedState(),operationIntent:{kind:'reserve',status:'active',provenance:{source:'user',revision:50}}};
  const proposal=planner.plan(plannerContext(state)); assert.equal(proposal.kind,'CALL_TOOL'); assert.equal(proposal.capabilityId,'reserve_single');
  return {...state,preparedOperation:{operationId:'op1',operationType:'reserve',operationFingerprint:'ofp',dependencyFingerprint:proposal.preconditionFingerprint,
    dependencyKeys:HOTEL_TASK_DEFINITION_V1.capabilities.reserve_single.dependencyKeys,canonicalInputSnapshot:proposal.groundedInput,status:'approval_required'}};
}
