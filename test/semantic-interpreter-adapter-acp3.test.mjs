import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StructuredSemanticInterpreterAdapter,
  ValidatedSemanticInterpreter,
  buildSemanticInterpreterRequest,
} from '../dist/core/semantic-interpreter-adapter.js';
import { HOTEL_SEMANTIC_CONTRACT_V1 } from '../dist/core/semantic-interpreter.js';

const input={
  currentUserMessage:'somos dos y quiero ver opciones',
  taskContextProjection:{taskType:'hotel_reservation_domain',lifecycle:'active',requestedStay:{guests:2},availabilitySummary:{status:'not_queried'},groundedSelectionSummary:{status:'none',count:0},bookingSummary:{count:0}},
  temporalContext:{trustedNow:'2026-09-13T11:00:00-03:00',timezone:'America/Argentina/Mendoza',locale:'es-AR',calendarPolicyId:'hotel-calendar-v1',temporalPolicyVersion:'1'},
  domainSemanticContract:HOTEL_SEMANTIC_CONTRACT_V1,
};

test('request is semantic-only and does not expose tool workflow',()=>{
  const request=buildSemanticInterpreterRequest(input);
  assert.equal(request.temperature,0);
  assert.equal(request.label,'acp.semantic_interpreter.v1');
  const visible=request.messages.map(x=>x.content).join('\n');
  assert.equal(visible.includes('hms.createReservation'),false);
  assert.equal(visible.includes('SECRET_ROOM'),false);
  assert.match(request.messages[0].content,/Do not select tools/);
});

test('semantic prompt makes strict patch and temporal provenance rules explicit without adding workflow authority',()=>{
  const request=buildSemanticInterpreterRequest({
    ...input,
    currentUserMessage:'Quiero reservar una habitación del 10 al 12 de febrero de 2027 para 2 personas.',
  });
  const prompt=request.messages[0].content;
  assert.match(prompt,/Every set patch must include value/);
  assert.match(prompt,/every clear patch must omit value/);
  assert.match(prompt,/Do not emit empty taskSemanticChanges or directives/);
  assert.match(prompt,/explicit absolute calendar dates/);
  assert.match(prompt,/omit temporalResolutionProvenance/);
  assert.match(prompt,/relative or deictic date language/);
  assert.match(prompt,/copy trustedNow, timezone and locale exactly/);
  assert.match(prompt,/calendarPolicyId as resolutionPolicyId/);
  assert.match(prompt,/temporalPolicyVersion as resolutionPolicyVersion/);
  assert.match(prompt,/Do not reconstruct a workflow/);
});

test('structured adapter delegates exactly once and returns raw value',async()=>{
  let calls=0; let captured;
  const provider={completeStructured:async(request)=>{calls++;captured=request;return{value:{classification:'task',taskSemanticChanges:{requestedGoal:{op:'set',value:'availability'}}}}}};
  const adapter=new StructuredSemanticInterpreterAdapter(provider);
  const raw=await adapter.interpret(input);
  assert.equal(calls,1); assert.equal(captured.label,'acp.semantic_interpreter.v1');
  assert.equal(raw.classification,'task');
});

test('validated interpreter accepts valid structured semantics',async()=>{
  const adapter={interpret:async()=>({classification:'task',taskSemanticChanges:{requestedGoal:{op:'set',value:'availability'}}})};
  const result=await new ValidatedSemanticInterpreter(adapter).interpret(input);
  assert.equal(result.ok,true);
});

test('invalid provider output fails closed with no fallback interpretation',async()=>{
  let calls=0;
  const adapter={interpret:async()=>{calls++;return{classification:'task',toolId:'hms.createReservation'}}};
  const result=await new ValidatedSemanticInterpreter(adapter).interpret(input);
  assert.equal(calls,1); assert.equal(result.ok,false);
});

test('provider failure returns explicit failure and does not retry',async()=>{
  let calls=0;
  const adapter={interpret:async()=>{calls++;throw new Error('down')}};
  const result=await new ValidatedSemanticInterpreter(adapter).interpret(input);
  assert.equal(calls,1); assert.deepEqual(result,{ok:false,message:'SEMANTIC_INTERPRETER_PROVIDER_FAILURE'});
});

test('blank or oversized user message is rejected before provider boundary',()=>{
  assert.throws(()=>buildSemanticInterpreterRequest({...input,currentUserMessage:'   '}),/SEMANTIC_INTERPRETER_INPUT_INVALID/);
  assert.throws(()=>buildSemanticInterpreterRequest({...input,currentUserMessage:'x'.repeat(4001)}),/SEMANTIC_INTERPRETER_INPUT_INVALID/);
});

test('validated structured adapter distinguishes local input rejection from provider failure',async()=>{
  let calls=0;
  const provider={completeStructured:async()=>{calls++;return{value:{classification:'unknown'}}}};
  const validated=new ValidatedSemanticInterpreter(new StructuredSemanticInterpreterAdapter(provider));
  const result=await validated.interpret({...input,currentUserMessage:'   '});
  assert.deepEqual(result,{ok:false,message:'SEMANTIC_INTERPRETER_INPUT_INVALID'});
  assert.equal(calls,0);
});
