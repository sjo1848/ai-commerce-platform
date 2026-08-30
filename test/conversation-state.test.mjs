import test from "node:test";
import assert from "node:assert/strict";
import { AgentCoreRuntime } from "../dist/core/runtime.js";

const roomId = "11000000-0000-0000-0000-000000000001";
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
        return { source: "hms", truth: "transactional", start: input.checkIn, end: input.checkOut, rooms: [{ id: roomId, roomNumber: "101" }] };
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
      if (call === 1) {
        return { kind: "message", message: "¿Para cuántas personas sería?", statePatch: { checkIn: "2027-01-15", checkOut: "2027-01-17" } };
      }
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

test("authoritative availability candidates plus a model selection become reusable quote state", async () => {
  const executions = [];
  let call = 0;
  const model = {
    async route(_message, _context, _tools, _conversation, state) {
      call += 1;
      if (call === 1) {
        return {
          kind: "tool",
          plan: { toolId: "hms.checkAvailability", input: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 } },
          statePatch: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
        };
      }
      assert.ok(state.availabilityRoomIds.includes(roomId));
      return { kind: "tool", plan: { toolId: "hms.getQuote", input: {} }, statePatch: { selectedRoomId: roomId } };
    },
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools: tools(executions), model });
  const firstContext = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  const first = await runtime.orchestrator.chat("Somos dos del 15 al 17", firstContext);
  const secondContext = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat", sessionId: first.sessionId });
  await runtime.orchestrator.chat("¿Cuánto sale la primera?", secondContext);

  assert.deepEqual(executions[1].input, { roomId, checkIn: "2027-01-15", checkOut: "2027-01-17" });
});
