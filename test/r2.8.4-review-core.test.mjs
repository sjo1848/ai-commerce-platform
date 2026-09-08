import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentCoreRuntime } from '../dist/core/runtime.js';
import { DeterministicGroundedResponder } from '../dist/core/model-responder.js';
import { applyConversationStatePatch, emptyConversationState, updateConversationStateFromTool } from '../dist/core/conversation-state.js';
import { LLMModelRouter } from '../dist/core/llm-model.js';
const stay = { checkIn: '2030-01-01', checkOut: '2030-01-03', guests: 4 };
const rooms = [{id:'room101', roomNumber:'101'}, {id:'room102', roomNumber:'102'}];
const ground = () => updateConversationStateFromTool(emptyConversationState(), 'hms.checkAvailability', stay, {rooms});
const grounding = {kind:'reservation',checkIn:stay.checkIn,checkOut:stay.checkOut,roomIds:rooms.map(r=>r.id)};
const route = (statePatch={}) => ({kind:'tool',plan:{toolId:'hms.createMultiReservation',input:{}},mutationGrounding:grounding,statePatch});
async function setup(routes) {
 const tool={id:'hms.createMultiReservation',risk:'write',primitive:'RESERVE',description:'reserve',sideEffect:'reversible',requiredPermissions:[],inputSchema:{type:'object',properties:{roomIds:{},checkIn:{},checkOut:{}},required:['roomIds','checkIn','checkOut']},validateInput:input=>({ok:true,value:input}),execute:async()=>{throw Error('MUTATION MUST NOT EXECUTE');}};
 const tenant={id:'review',slug:'review',status:'active',allowedToolIds:[tool.id],toolPolicies:{[tool.id]:'approval'}};
 const runtime=new AgentCoreRuntime({tenants:[tenant],tools:[tool],responder:new DeterministicGroundedResponder(),model:{route:async()=>routes.shift()}});
 const context=await runtime.createContext({tenantId:tenant.id,actor:{id:'actor',type:'customer',roles:['customer'],permissions:[]},channel:'webchat'});
 await runtime.conversationState.put(context.session.id,{...ground(),semanticMemory:{...ground().semanticMemory,scope:{tenantId:tenant.id,actorId:'actor',sessionId:context.session.id}}});
 return {runtime,context,tool};
}
test('review occupancy is checked on the current write turn and correct occupancy reaches unconsumed HITL',async()=>{
 for(const guests of [1,2]) {
  const {runtime,context}=await setup([route({selectedRoomNumbers:['101','102'],roomOccupancy:[{roomNumber:'101',guests:2},{roomNumber:'102',guests}]})]);
  if(guests===1) assert.equal((await runtime.orchestrator.chat('reservar',context)).outcome,'clarification');
  else await assert.rejects(runtime.orchestrator.chat('reservar',context),e=>e.code==='APPROVAL_REQUIRED'&&e.plan.toolId==='hms.createMultiReservation');
 }
});
test('review explicit selection cannot contradict mutation grounding',async()=>{
 const {runtime,context}=await setup([route({selectedRoomNumbers:['101']})]);
 assert.equal((await runtime.orchestrator.chat('reservar',context)).outcome,'clarification');
});
test('review ambiguous partial selection clears prior authority and cannot be reused for a write',async()=>{
 const {runtime,context}=await setup([{kind:'message',purpose:'acknowledgement',message:'Perfecto',missing:['selection'],statePatch:{selectedRoomNumbers:['101']}},route()]);
 const result=await runtime.orchestrator.chat('ambiguous',context);
 assert.equal(result.outcome,'clarification'); assert.deepEqual(result.missing,['selection']);
 const state=await runtime.conversationState.get(context.session.id);
 assert.deepEqual(state.selectedRoomIds,[]); assert.equal(state.roomSelectionNeedsClarification,true);
 assert.equal((await runtime.orchestrator.chat('reuse',context)).outcome,'clarification');
});
test('review new structured availability and quote promote exact stay and invalidate old selection',()=>{
 const previous=applyConversationStatePatch(ground(),{selectedRoomNumbers:['101','102']});
 const revised={...stay,checkIn:'2030-02-01',checkOut:'2030-02-03'};
 const available=updateConversationStateFromTool(previous,'hms.checkAvailability',revised,{rooms},{currentQuery:true});
 assert.deepEqual(available.stay,revised);assert.deepEqual(available.selectedRoomIds,[]);assert.equal(available.availabilityRooms.length,2);
 const quote=updateConversationStateFromTool(previous,'hms.getQuote',{...revised,roomId:'room101'},{roomId:'room101'},{currentQuery:true});
 assert.equal(quote.stay.checkIn,revised.checkIn);assert.deepEqual(quote.availabilityRoomIds,['room101']);assert.deepEqual(quote.selectedRoomIds,['room101']);
});
test('review raw language cannot seed stay or override structured model route',async()=>{
 const {runtime,context}=await setup([{kind:'message',purpose:'acknowledgement',message:'ok',statePatch:{}}]);
 await runtime.orchestrator.chat('Somos tres del 20 al 22 de febrero',context);
 assert.deepEqual((await runtime.conversationState.get(context.session.id)).stay,stay);
});
test('review router rejects contradictory explicit selection before returning write',async()=>{
 const {context,tool}=await setup([]);
 const value={kind:'tool',toolId:tool.id,input:{},statePatch:{selectedRoomNumbers:['101']},mutationGrounding:grounding,clarificationReason:'none',missing:[]};
 const router=new LLMModelRouter({completeStructured:async()=>({value,model:'offline'})},{route:async()=>({kind:'message',message:'clarify',purpose:'clarification',missing:['selection']})});
 assert.equal((await router.route('reserve',context,[tool],[],ground())).kind,'message');
});

test('review fresh query replaces prior structured user correction but late results preserve newer candidates', async()=>{
 let release;let started;
 const entered=new Promise(r=>started=r);
 const tool={id:'hms.checkAvailability',risk:'read',primitive:'CHECK',description:'availability',sideEffect:'none',requiredPermissions:[],inputSchema:{type:'object',properties:{checkIn:{},checkOut:{},guests:{}},required:['checkIn','checkOut','guests']},validateInput:input=>({ok:true,value:input}),execute:async()=>{started();await new Promise(r=>release=r);return {rooms};}};
 const tenant={id:'read-review',slug:'read-review',status:'active',allowedToolIds:[tool.id],toolPolicies:{[tool.id]:'auto'}};
 const revised={...stay,checkIn:'2030-02-01',checkOut:'2030-02-03'};
 const runtime=new AgentCoreRuntime({tenants:[tenant],tools:[tool],responder:new DeterministicGroundedResponder(),model:{route:async()=>({kind:'tool',plan:{toolId:tool.id,input:revised},statePatch:{}})}});
 const context=await runtime.createContext({tenantId:tenant.id,actor:{id:'actor',type:'customer',roles:['customer'],permissions:[]},channel:'webchat'});
 let state=applyConversationStatePatch(ground(),{checkIn:'2030-01-02'},{semanticSource:'user'});
 state.semanticMemory.scope={tenantId:tenant.id,actorId:'actor',sessionId:context.session.id};
 await runtime.conversationState.put(context.session.id,state);
 const pending=runtime.orchestrator.chat('fresh date query',context);await entered;
 release();await pending;
 assert.deepEqual((await runtime.conversationState.get(context.session.id)).stay,revised);
 // Start another read with same dates; refresh candidate identity while it waits.
 let startedAgain;const enteredAgain=new Promise(r=>startedAgain=r);started=startedAgain;
 const second=runtime.orchestrator.chat('refresh',context);await enteredAgain;
 const now=await runtime.conversationState.get(context.session.id);
 const fresh=updateConversationStateFromTool(now,tool.id,revised,{rooms:[{id:'new-room',roomNumber:'201'}]},{currentQuery:true});
 await runtime.conversationState.put(context.session.id,fresh);
 release();assert.equal((await second).outcome,'clarification');
 assert.deepEqual((await runtime.conversationState.get(context.session.id)).availabilityRoomIds,['new-room']);
});

test('review contradictory current structured query fails before tool execution',async()=>{
 let executed=0;
 const tool={id:'hms.checkAvailability',risk:'read',primitive:'CHECK',description:'availability',sideEffect:'none',requiredPermissions:[],inputSchema:{type:'object',properties:{checkIn:{},checkOut:{},guests:{}},required:['checkIn','checkOut','guests']},validateInput:input=>({ok:true,value:input}),execute:async()=>{executed++;return {rooms};}};
 const tenant={id:'contradiction',slug:'contradiction',status:'active',allowedToolIds:[tool.id],toolPolicies:{[tool.id]:'auto'}};
 const runtime=new AgentCoreRuntime({tenants:[tenant],tools:[tool],model:{route:async()=>({kind:'tool',plan:{toolId:tool.id,input:stay},statePatch:{guests:3}})}});
 const context=await runtime.createContext({tenantId:tenant.id,actor:{id:'actor',type:'customer',roles:['customer'],permissions:[]},channel:'webchat'});
 assert.equal((await runtime.orchestrator.chat('availability',context)).outcome,'clarification');assert.equal(executed,0);
});

test('review model routing preserves authoritative dates independently from guest provenance',async()=>{
 let seen;const {runtime,context}=await setup([]);
 runtime.orchestrator.model; // Separate runtime to inspect the model input through its public protocol.
 const tenant={id:'provenance',slug:'provenance',status:'active',allowedToolIds:[],toolPolicies:{}};
 const other=new AgentCoreRuntime({tenants:[tenant],tools:[],model:{route:async(_m,_c,_t,_h,state)=>{seen=state;return {kind:'message',purpose:'acknowledgement',message:'ok'};}}});
 const ctx=await other.createContext({tenantId:tenant.id,actor:{id:'actor',type:'customer',roles:['customer'],permissions:[]},channel:'webchat'});
 const state=applyConversationStatePatch(ground(),{guests:3},{semanticSource:'user'});state.semanticMemory.scope={tenantId:tenant.id,actorId:'actor',sessionId:ctx.session.id};
 await other.conversationState.put(ctx.session.id,state);await other.orchestrator.chat('continue',ctx);
 assert.equal(seen.stay.checkIn,stay.checkIn);assert.equal(seen.stay.checkOut,stay.checkOut);assert.equal(seen.stay.guests,undefined);
});
