import test from "node:test";
import assert from "node:assert/strict";
import { LLMModelRouter } from "../dist/core/llm-model.js";

const context = {
  requestId: "r",
  tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: ["hms.checkAvailability", "hms.getQuote", "hms.createReservation"] },
  actor: { id: "visitor", type: "customer", roles: ["customer"], permissions: [] },
  session: { id: "s", tenantId: "hotel-demo", actorId: "visitor", channel: "webchat", createdAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z" },
  now: "2026-08-30T13:00:00.000Z",
};

const tools = [
  {
    id: "hms.checkAvailability", primitive: "CHECK", risk: "read", description: "availability",
    inputSchema: { type: "object", properties: { checkIn: {}, checkOut: {}, guests: {} }, required: ["checkIn", "checkOut", "guests"] },
  },
  {
    id: "hms.getQuote", primitive: "QUOTE", risk: "read", description: "quote",
    inputSchema: { type: "object", properties: { roomId: {}, checkIn: {}, checkOut: {} }, required: ["roomId", "checkIn", "checkOut"] },
  },
  {
    id: "hms.createReservation", primitive: "RESERVE", risk: "write", description: "reserve",
    inputSchema: { type: "object", properties: { roomId: {}, checkIn: {}, checkOut: {} }, required: ["roomId", "checkIn", "checkOut"] },
  },
];

test("router prompt makes capability requirements independent across availability and reservation", async () => {
  const provider = {
    request: null,
    async completeStructured(request) {
      this.request = request;
      return {
        value: {
          kind: "tool",
          toolId: "hms.checkAvailability",
          input: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
          clarificationReason: "none",
          missing: [],
        },
      };
    },
  };
  const fallback = { async route() { throw new Error("fallback must not run"); } };
  const router = new LLMModelRouter(provider, fallback);
  const result = await router.route(
    "Hola, somos dos y queremos quedarnos del 15 al 17 de enero de 2027. ¿Tenés algo disponible?",
    context,
    tools,
  );
  assert.equal(result.kind, "tool");
  const system = provider.request.messages[0].content;
  assert.match(system, /Critical arguments are dates \+ guests ONLY/i);
  assert.match(system, /availability\/search request NEVER needs a room, selection or booking/i);
  assert.match(system, /Critical arguments are a grounded room\/selection \+ dates ONLY/i);
  assert.match(system, /Guest count is NOT a reservation argument/i);
  assert.match(system, /Do not inherit the guests requirement from a previous availability step/i);
  assert.match(system, /reservation request NEVER needs guest count/i);
  assert.match(system, /Do NOT ask how many guests/i);
  assert.match(system, /del 15 al 17 de enero de 2027/i);
  assert.match(system, /Cuánto sale la primera/i);
});
