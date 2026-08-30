import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryConversationStore } from "../dist/core/conversation.js";
import { applyConversationStatePatch, ConversationBackedStateStore, InMemoryConversationStateStore } from "../dist/core/conversation-state.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { InMemorySessionStore } from "../dist/core/session.js";

const roomId = "11000000-0000-0000-0000-000000000001";
const secondRoomId = "11000000-0000-0000-0000-000000000002";
const tenant = {
  id: "hotel-demo",
  slug: "hotel-demo",
  status: "active",
  allowedToolIds: ["hms.checkAvailability", "hms.getQuote"],
  toolPolicies: { "hms.checkAvailability": "auto", "hms.getQuote": "auto" },
};
const actor = { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.availability.read", "hms.quote.read"] };

function tools(executions) {
  return [
    {
      id: "hms.checkAvailability", primitive: "CHECK", description: "availability", risk: "read", sideEffect: "none",
      requiredPermissions: ["hms.availability.read"],
      inputSchema: { type: "object", properties: { checkIn: {}, checkOut: {}, guests: {} }, required: ["checkIn", "checkOut", "guests"] },
      validateInput(input) {
        if (!input?.checkIn || !input?.checkOut || !Number.isInteger(input?.guests)) return { ok: false, message: "missing availability fields" };
        return { ok: true, value: input };
      },
      async execute(input) {
        executions.push({ toolId: "hms.checkAvailability", input: structuredClone(input) });
        return { source: "hms", truth: "transactional", start: input.checkIn, end: input.checkOut, rooms: [{ id: roomId, roomNumber: "101" }, { id: secondRoomId, roomNumber: "102" }] };
      },
    },
    {
      id: "hms.getQuote", primitive: "QUOTE", description: "quote", risk: "read", sideEffect: "none",
      requiredPermissions: ["hms.quote.read"],
      inputSchema: { type: "object", properties: { roomId: {}, checkIn: {}, checkOut: {} }, required: ["roomId", "checkIn", "checkOut"] },
      validateInput(input) {
        if (!input?.roomId || !input?.checkIn || !input?.checkOut) return { ok: false, message: "missing quote fields" };
        return { ok: true, value: input };
      },
      async execute(input) {
        executions.push({ toolId: "hms.getQuote", input: structuredClone(input) });
        return { source: "hms", truth: "transactional", roomId: input.roomId, start: input.checkIn, end: input.checkOut, totalCents: 50000, currency: "ARS" };
      },
    },
  ];
}

test("dates survive a clarification turn and are not requested again when guests arrive later", async () => {
  const executions = [];
  const seenStates = [];
  let call = 0;
  const model = {
    async route(_message, _context, _tools, _conversation, state) {
      seenStates.push(structuredClone(state));
      call += 1;
      if (call === 1) return { kind: "message", message: "¿Para cuántas personas sería?", statePatch: { checkIn: "2027-01-15", checkOut: "2027-01-17" } };
      return { kind: "tool", plan: { toolId: "hms.checkAvailability", input: { guests: 2 } }, statePatch: { guests: 2 } };
    },
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools: tools(executions), model });
  const firstContext = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  const first = await runtime.orchestrator.chat("Quiero ir del 15 al 17 de enero de 2027", firstContext);
  assert.match(first.message, /cuántas personas/i);

  const secondContext = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat", sessionId: first.sessionId });
  await runtime.orchestrator.chat("Somos dos", secondContext);

  assert.equal(seenStates[1].stay.checkIn, "2027-01-15");
  assert.equal(seenStates[1].stay.checkOut, "2027-01-17");
  assert.deepEqual(executions[0].input, { guests: 2, checkIn: "2027-01-15", checkOut: "2027-01-17" });
});

test("incomplete tool plan becomes clarification after persisting its state patch", async () => {
  const executions = [];
  let call = 0;
  const model = {
    async route() {
      call += 1;
      if (call === 1) {
        return {
          kind: "tool",
          plan: { toolId: "hms.checkAvailability", input: { checkIn: "2027-01-15", checkOut: "2027-01-17" } },
          statePatch: { checkIn: "2027-01-15", checkOut: "2027-01-17" },
        };
      }
      return { kind: "tool", plan: { toolId: "hms.checkAvailability", input: { guests: 2 } }, statePatch: { guests: 2 } };
    },
  };
  const stateStore = new InMemoryConversationStateStore();
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools: tools(executions), model, conversationStateStore: stateStore });
  const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });

  const first = await runtime.orchestrator.chat("Necesito disponibilidad del 15 al 17 de enero de 2027", context);
  assert.match(first.message, /cuántas personas/i);
  assert.equal(executions.length, 0);
  assert.deepEqual((await stateStore.get(context.session.id)).stay, { checkIn: "2027-01-15", checkOut: "2027-01-17" });

  const secondContext = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat", sessionId: context.session.id });
  await runtime.orchestrator.chat("Somos dos", secondContext);
  assert.deepEqual(executions[0].input, { guests: 2, checkIn: "2027-01-15", checkOut: "2027-01-17" });
});

test("present but invalid required value still fails closed instead of becoming a clarification", async () => {
  const executions = [];
  const model = {
    async route() {
      return {
        kind: "tool",
        plan: { toolId: "hms.checkAvailability", input: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 0 } },
        statePatch: { checkIn: "2027-01-15", checkOut: "2027-01-17" },
      };
    },
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools: tools(executions), model });
  const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  await assert.rejects(
    runtime.orchestrator.chat("Somos cero", context),
    (error) => error?.code === "BAD_REQUEST" && error?.status === 400,
  );
  assert.equal(executions.length, 0);
});

test("ordinal model selection is resolved server-side against authoritative availability order", async () => {
  const executions = [];
  let call = 0;
  const model = {
    async route(_message, _context, _tools, _conversation, state) {
      call += 1;
      if (call === 1) {
        return { kind: "tool", plan: { toolId: "hms.checkAvailability", input: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 } }, statePatch: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 } };
      }
      assert.deepEqual(state.availabilityRoomIds, [roomId, secondRoomId]);
      return { kind: "tool", plan: { toolId: "hms.getQuote", input: {} }, statePatch: { selectedRoomIndex: 1 } };
    },
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools: tools(executions), model });
  const firstContext = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  const first = await runtime.orchestrator.chat("Somos dos del 15 al 17", firstContext);
  const secondContext = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat", sessionId: first.sessionId });
  await runtime.orchestrator.chat("¿Cuánto sale la primera?", secondContext);
  assert.deepEqual(executions[1].input, { roomId, checkIn: "2027-01-15", checkOut: "2027-01-17" });
});

test("reservation continuation with known dates but no room asks only for selection", async () => {
  const reservationTenant = {
    id: "hotel-reservation-demo",
    slug: "hotel-reservation-demo",
    status: "active",
    allowedToolIds: ["hms.createReservation"],
    toolPolicies: { "hms.createReservation": "approval" },
  };
  const reservationActor = {
    id: "visitor-demo",
    type: "customer",
    roles: ["customer"],
    permissions: ["hms.reservation.write"],
  };
  let executions = 0;
  const reservationTool = {
    id: "hms.createReservation",
    primitive: "RESERVE",
    description: "reservation",
    risk: "write",
    sideEffect: "reversible",
    requiredPermissions: ["hms.reservation.write"],
    inputSchema: { type: "object", properties: { roomId: {}, checkIn: {}, checkOut: {} }, required: ["roomId", "checkIn", "checkOut"] },
    validateInput(input) {
      if (!input?.roomId || !input?.checkIn || !input?.checkOut) return { ok: false, message: "room and dates required" };
      return { ok: true, value: input };
    },
    async execute() {
      executions += 1;
      return { bookingId: "booking-1", status: "CONFIRMED" };
    },
  };
  const stateStore = new InMemoryConversationStateStore();
  const runtime = new AgentCoreRuntime({
    tenants: [reservationTenant],
    tools: [reservationTool],
    conversationStateStore: stateStore,
    model: {
      async route() {
        return { kind: "tool", plan: { toolId: "hms.createReservation", input: {} }, statePatch: {} };
      },
    },
  });
  const context = await runtime.createContext({ tenantId: reservationTenant.id, actor: reservationActor, channel: "webchat" });
  await stateStore.put(context.session.id, {
    stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    availabilityRoomIds: [roomId, secondRoomId],
  });

  const result = await runtime.orchestrator.chat("Para las fechas que te dije ya", context);
  assert.match(result.message, /habitación|opción/i);
  assert.doesNotMatch(result.message, /fecha|persona/i);
  assert.equal(executions, 0);
  assert.deepEqual((await stateStore.get(context.session.id)).stay, { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });
});

test("model cannot persist a selected room or ordinal outside authoritative availability", () => {
  const current = { stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 }, availabilityRoomIds: [roomId, secondRoomId] };
  const fakeId = applyConversationStatePatch(current, { selectedRoomId: "22000000-0000-0000-0000-000000000099" });
  assert.equal(fakeId.selectedRoomId, undefined);
  const outOfRange = applyConversationStatePatch(current, { selectedRoomIndex: 3 });
  assert.equal(outOfRange.selectedRoomId, undefined);
  const staleSelection = applyConversationStatePatch({ ...current, selectedRoomId: roomId }, { selectedRoomIndex: 3 });
  assert.equal(staleSelection.selectedRoomId, undefined);
  const validSecond = applyConversationStatePatch(current, { selectedRoomIndex: 2 });
  assert.equal(validSecond.selectedRoomId, secondRoomId);
});

test("conversation-backed state survives runtime replacement and internal snapshots never enter model history", async () => {
  const executions = [];
  const sessions = new InMemorySessionStore();
  const conversation = new InMemoryConversationStore(32);
  const stateStore1 = new ConversationBackedStateStore(conversation);
  const firstModel = {
    async route() {
      return { kind: "message", message: "¿Para cuántas personas sería?", statePatch: { checkIn: "2027-01-15", checkOut: "2027-01-17" } };
    },
  };
  const runtime1 = new AgentCoreRuntime({ tenants: [tenant], tools: tools(executions), model: firstModel, sessionStore: sessions, conversationStore: conversation, conversationStateStore: stateStore1 });
  const firstContext = await runtime1.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  await runtime1.orchestrator.chat("Quiero ir del 15 al 17", firstContext);

  let observed;
  const runtime2 = new AgentCoreRuntime({
    tenants: [tenant], tools: tools(executions), sessionStore: sessions, conversationStore: conversation,
    conversationStateStore: new ConversationBackedStateStore(conversation),
    model: {
      async route(_message, _context, _tools, history, state) {
        observed = { history: structuredClone(history), state: structuredClone(state) };
        return { kind: "tool", plan: { toolId: "hms.checkAvailability", input: { guests: 2 } }, statePatch: { guests: 2 } };
      },
    },
  });
  const secondContext = await runtime2.createContext({ tenantId: tenant.id, actor, channel: "webchat", sessionId: firstContext.session.id });
  await runtime2.orchestrator.chat("Somos dos", secondContext);

  assert.equal(observed.state.stay.checkIn, "2027-01-15");
  assert.equal(observed.state.stay.checkOut, "2027-01-17");
  assert.ok(observed.history.every((turn) => turn.toolId !== "__conversation_state"));
  assert.deepEqual(executions[0].input, { guests: 2, checkIn: "2027-01-15", checkOut: "2027-01-17" });
});
