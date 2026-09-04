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

test("router prompt separates capability requirements and exposes only model-safe durable state", async () => {
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
  const durableState = {
    stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    semanticMemory: {
      revision: 7,
      scope: { tenantId: "secret-tenant-scope", actorId: "secret-actor-scope", sessionId: "secret-session-scope" },
      stay: {
        checkIn: { source: "user", revision: 4 },
        checkOut: { source: "user", revision: 4 },
        guests: { source: "user", revision: 7 },
      },
      preferences: [{ value: "cama matrimonial", source: "user", revision: 6 }],
      activeIntent: { value: "availability", source: "user", revision: 7 },
    },
    availabilityRoomIds: [],
  };
  const result = await router.route(
    "Hola, somos dos y queremos quedarnos del 15 al 17 de enero de 2027. ¿Tenés algo disponible?",
    context,
    tools,
    [],
    durableState,
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
  assert.match(system, /explicit room-count declaration must match the final explicit room reference set/i);
  assert.match(system, /If they differ, ask for selection clarification; never acknowledge or route a write/i);
  assert.match(system, /Quiero reservar la 101 y la 102.*mutationGrounding=\{kind:'reservation',checkIn:'2027-01-15',checkOut:'2027-01-17',roomIds:\['roomA','roomB'\]\}/i);
  assert.match(system, /reservá esas dos.*mutationGrounding=\{kind:'reservation',checkIn:'2027-01-15',checkOut:'2027-01-17',roomIds:\['roomA','roomB'\]\}/i);
  assert.match(system, /me quedo con la segunda, reservámela.*mutationGrounding=\{kind:'reservation',checkIn:'2027-01-15',checkOut:'2027-01-17',roomIds:\['roomB'\]\}/i);
  assert.match(system, /cama matrimonial/i);
  assert.match(system, /unverified user requests\/context only/i);
  assert.match(system, /Core independently owns durable semantic persistence/i);
  assert.doesNotMatch(system, /secret-tenant-scope/i);
  assert.doesNotMatch(system, /secret-actor-scope/i);
  assert.doesNotMatch(system, /secret-session-scope/i);
  assert.doesNotMatch(system, /"revision"/i);
  assert.doesNotMatch(system, /"source"/i);
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
          mutationGrounding: null,
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
