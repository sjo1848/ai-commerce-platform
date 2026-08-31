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

test("router prompt separates capability requirements and prioritizes durable conversational state", async () => {
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
          statePatch: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
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
  assert.match(system, /CURRENT_CONVERSATION_STATE=/i);
  assert.match(system, /priority over reconstructing old user facts/i);
  assert.match(system, /Never ask again for a value already present there/i);
  assert.match(system, /Critical arguments are dates \+ guests ONLY/i);
  assert.match(system, /reservation request NEVER needs guest count/i);
  assert.match(system, /server may fill omitted arguments from durable state/i);
  assert.match(system, /del 15 al 17 de enero de 2027/i);
  assert.match(system, /para las que te dije ya/i);
  assert.match(system, /Pure greeting with no operational request/i);
  assert.match(system, /Social-only turns never clear/i);
});

test("pure greeting is classified as a conversational message, not an operational tool", async () => {
  const provider = {
    async completeStructured() {
      return {
        value: {
          kind: "message",
          toolId: "",
          input: {},
          clarificationReason: "greeting",
          missing: [],
          statePatch: {},
        },
      };
    },
  };
  const fallback = { async route() { throw new Error("fallback must not run"); } };
  const router = new LLMModelRouter(provider, fallback);
  const result = await router.route("Hola", context, tools);
  assert.equal(result.kind, "message");
  assert.equal(result.purpose, "greeting");
  assert.match(result.message, /hola/i);
});

test("social-only model output cannot mutate durable operational state", async () => {
  let fallbackCalled = false;
  const provider = {
    async completeStructured() {
      return {
        value: {
          kind: "message",
          toolId: "",
          input: {},
          clarificationReason: "social",
          missing: [],
          statePatch: { guests: 9 },
        },
      };
    },
  };
  const fallback = {
    async route() {
      fallbackCalled = true;
      return { kind: "message", purpose: "social", message: "De nada. Cuando quieras, seguimos con la estadía." };
    },
  };
  const router = new LLMModelRouter(provider, fallback);
  const result = await router.route("Gracias", context, tools);
  assert.equal(fallbackCalled, true);
  assert.equal(result.kind, "message");
  assert.equal(result.purpose, "social");
});