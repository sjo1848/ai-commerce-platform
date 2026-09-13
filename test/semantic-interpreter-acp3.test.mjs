import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOTEL_SEMANTIC_CONTRACT_V1,
  projectTaskStateForInterpreter,
} from '../dist/core/semantic-interpreter.js';
import { SEMANTIC_INTERPRETER_OUTPUT_SCHEMA } from '../dist/core/semantic-interpreter-schema.js';
import { validateInterpreterOutput } from '../dist/core/semantic-interpreter-validation.js';

const input = {
  currentUserMessage:'quiero reservar del 15 al 17',
  taskContextProjection:{
    taskType:'hotel_reservation_domain', lifecycle:'active', requestedStay:{},
    availabilitySummary:{status:'not_queried'}, groundedSelectionSummary:{status:'none',count:0}, bookingSummary:{count:0},
  },
  temporalContext:{trustedNow:'2026-09-13T11:00:00-03:00',timezone:'America/Argentina/Mendoza',locale:'es-AR',calendarPolicyId:'hotel-calendar-v1',temporalPolicyVersion:'1'},
  domainSemanticContract:HOTEL_SEMANTIC_CONTRACT_V1,
};

const validTask = (extra={}) => ({classification:'task', taskSemanticChanges:{requestedGoal:{op:'set',value:'reservation'}}, ...extra});

test('accepts semantic goal without inventing operation intent',()=>{
  const result=validateInterpreterOutput(validTask(),input);
  assert.equal(result.ok,true);
  assert.equal(result.value.taskSemanticChanges.requestedGoal.value,'reservation');
  assert.equal(result.value.taskSemanticChanges.operationIntent,undefined);
});

test('supports explicit set clear and omission=noChange',()=>{
  const raw={classification:'task',taskSemanticChanges:{guests:{op:'set',value:2},preferences:{op:'clear'}}};
  const result=validateInterpreterOutput(raw,input);
  assert.equal(result.ok,true);
  assert.deepEqual(result.value.taskSemanticChanges.guests,{op:'set',value:2});
  assert.deepEqual(result.value.taskSemanticChanges.preferences,{op:'clear'});
  assert.equal(result.value.taskSemanticChanges.checkIn,undefined);
});

test('rejects operational fields such as toolId',()=>{
  const result=validateInterpreterOutput({...validTask(),toolId:'hms.createReservation'},input);
  assert.equal(result.ok,false);
});

test('rejects internal roomId grounding from model',()=>{
  const raw={classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'room_number',roomNumber:'101',roomId:'r101',scope:'entity_scoped'}}}};
  assert.equal(validateInterpreterOutput(raw,input).ok,false);
});

test('accepts semantic room ordinal without internal id',()=>{
  const raw={classification:'task',taskSemanticChanges:{requestedSelectionReference:{op:'set',value:{kind:'ordinal',ordinal:2,scope:'observation_scoped'}}}};
  const result=validateInterpreterOutput(raw,input);
  assert.equal(result.ok,true);
  assert.equal(result.value.taskSemanticChanges.requestedSelectionReference.value.ordinal,2);
});

test('booking code stays a semantic reference, bookingId is rejected',()=>{
  const good={classification:'task',taskSemanticChanges:{bookingReference:{op:'set',value:{kind:'explicit_code',code:'BK-123'}}}};
  assert.equal(validateInterpreterOutput(good,input).ok,true);
  const bad={classification:'task',taskSemanticChanges:{bookingReference:{op:'set',value:{kind:'explicit_code',code:'BK-123',bookingId:'internal'}}}};
  assert.equal(validateInterpreterOutput(bad,input).ok,false);
});

test('abort current operation is distinct from cancel booking',()=>{
  const abort={classification:'task',directives:{abortCurrentOperation:true}};
  const a=validateInterpreterOutput(abort,input);
  assert.equal(a.ok,true); assert.equal(a.value.taskSemanticChanges,undefined);
  const cancel={classification:'task',taskSemanticChanges:{requestedGoal:{op:'set',value:'cancellation'},bookingReference:{op:'set',value:{kind:'explicit_code',code:'BK-123'}},operationIntent:{op:'set',value:{kind:'cancel',status:'active',targetSemanticReference:{kind:'explicit_code',code:'BK-123'}}}}};
  const c=validateInterpreterOutput(cancel,input);
  assert.equal(c.ok,true); assert.equal(c.value.taskSemanticChanges.operationIntent.value.kind,'cancel');
});

test('read request can coexist with active reserve intent',()=>{
  const raw={classification:'task',taskSemanticChanges:{operationIntent:{op:'set',value:{kind:'reserve',status:'active',targetSemanticReference:{kind:'ordinal',ordinal:1,scope:'observation_scoped'}}}},directives:{readRequest:{kind:'quote'}}};
  const result=validateInterpreterOutput(raw,input);
  assert.equal(result.ok,true);
  assert.equal(result.value.directives.readRequest.kind,'quote');
  assert.equal(result.value.taskSemanticChanges.operationIntent.value.kind,'reserve');
});

test('social/help classifications cannot mutate task state',()=>{
  assert.equal(validateInterpreterOutput({classification:'social',directives:{interaction:'social'}},input).ok,true);
  assert.equal(validateInterpreterOutput({classification:'social',directives:{interaction:'social'},taskSemanticChanges:{guests:{op:'set',value:2}}},input).ok,false);
});

test('temporal provenance must echo trusted server context and match semantic dates',()=>{
  const good={classification:'task',taskSemanticChanges:{checkIn:{op:'set',value:'2026-09-15'},checkOut:{op:'set',value:'2026-09-17'}},temporalResolutionProvenance:{expressionClass:'explicit_range',trustedNow:input.temporalContext.trustedNow,timezone:input.temporalContext.timezone,locale:input.temporalContext.locale,normalizedDates:{checkIn:'2026-09-15',checkOut:'2026-09-17'},resolutionPolicyId:input.temporalContext.calendarPolicyId,resolutionPolicyVersion:input.temporalContext.temporalPolicyVersion}};
  assert.equal(validateInterpreterOutput(good,input).ok,true);
  const forged=structuredClone(good); forged.temporalResolutionProvenance.timezone='UTC';
  assert.equal(validateInterpreterOutput(forged,input).ok,false);
  const mismatch=structuredClone(good); mismatch.taskSemanticChanges.checkIn.value='2026-09-16';
  assert.equal(validateInterpreterOutput(mismatch,input).ok,false);
});

test('invalid or reversed date range fails closed against existing task context',()=>{
  const datedInput={...input,taskContextProjection:{...input.taskContextProjection,requestedStay:{checkOut:'2026-09-17'}}};
  assert.equal(validateInterpreterOutput({classification:'task',taskSemanticChanges:{checkIn:{op:'set',value:'2026-09-18'}}},datedInput).ok,false);
  assert.equal(validateInterpreterOutput({classification:'task',taskSemanticChanges:{checkIn:{op:'set',value:'2026-02-30'}}},input).ok,false);
});

test('unknown output cannot smuggle directives',()=>{
  assert.equal(validateInterpreterOutput({classification:'unknown'},input).ok,true);
  assert.equal(validateInterpreterOutput({classification:'unknown',directives:{readRequest:{kind:'availability'}}},input).ok,false);
});

test('task context projection excludes operational room and booking ids',()=>{
  const state={
    taskId:'t',sessionId:'s',taskType:'hotel_reservation_domain',lifecycle:'active',stateRevision:9,recentEventIds:[],
    requestedStay:{checkIn:{value:'2026-09-15',provenance:{source:'user',revision:1}}},preferences:[],
    availability:{status:'observed',rooms:[{roomId:'SECRET_ROOM'}]},quote:{status:'not_queried',roomIds:[]},
    groundedSelection:{status:'grounded',roomIds:['SECRET_ROOM']},bookings:[{bookingId:'SECRET_BOOKING'}],execution:{status:'not_started'},
  };
  const projection=projectTaskStateForInterpreter(state);
  const serialized=JSON.stringify(projection);
  assert.equal(serialized.includes('SECRET_ROOM'),false);
  assert.equal(serialized.includes('SECRET_BOOKING'),false);
  assert.equal(serialized.includes('stateRevision'),false);
  assert.deepEqual(projection.groundedSelectionSummary,{status:'grounded',count:1});
});

test('provider schema contains semantic vocabulary but excludes operational authority fields',()=>{
  const serialized=JSON.stringify(SEMANTIC_INTERPRETER_OUTPUT_SCHEMA);
  for (const forbidden of ['toolId','roomId','bookingId','operationFingerprint','dependencyFingerprint','approval']) {
    assert.equal(serialized.includes(forbidden),false,forbidden);
  }
  assert.equal(serialized.includes('operationIntent'),true);
  assert.equal(serialized.includes('abortCurrentOperation'),true);
});

test('empty task semantic containers are rejected instead of counting as meaning',()=>{
  assert.equal(validateInterpreterOutput({classification:'task',taskSemanticChanges:{}},input).ok,false);
  assert.equal(validateInterpreterOutput({classification:'task',directives:{}},input).ok,false);
});

test('domain semantic contract narrows model output even when base schema is broader',()=>{
  const narrow={...input,domainSemanticContract:{...HOTEL_SEMANTIC_CONTRACT_V1,allowedGoals:['availability'],allowedOperationIntents:['reserve'],allowedReadRequests:['availability']}};
  assert.equal(validateInterpreterOutput({classification:'task',taskSemanticChanges:{requestedGoal:{op:'set',value:'reservation'}}},narrow).ok,false);
  assert.equal(validateInterpreterOutput({classification:'task',directives:{readRequest:{kind:'quote'}}},narrow).ok,false);
  assert.equal(validateInterpreterOutput({classification:'task',taskSemanticChanges:{operationIntent:{op:'set',value:{kind:'cancel',status:'active'}}}},narrow).ok,false);
});
