import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicGroundedResponder, LLMGroundedResponder, buildGroundedFactEnvelope } from "../dist/core/model-responder.js";

const context = {
  requestId: "r",
  tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: [] },
  actor: { id: "visitor", type: "customer", roles: ["customer"], permissions: [] },
  session: { id: "s", tenantId: "hotel-demo", actorId: "visitor", channel: "webchat", createdAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z" },
  now: "2026-08-30T13:00:00.000Z",
};

function provider(value, error) {
  return {
    async completeStructured() {
      if (error) throw error;
      return { value };
    },
  };
}

function availabilityInput() {
  return {
    toolId: "hms.checkAvailability",
    data: { rooms: [{ roomNumber: "101", roomType: "DOBLE", priceCents: 25000 }] },
    conversation: [],
    context,
  };
}

test("deterministic responder renders availability using only tool result", async () => {
  const responder = new DeterministicGroundedResponder();
  const message = await responder.compose(availabilityInput());
  assert.match(message, /habitación 101/i);
  assert.match(message, /DOBLE/);
  assert.match(message, /\$250/);
});

test("R2.2 envelope exposes server-owned fact placeholders", () => {
  const envelope = buildGroundedFactEnvelope("hms.checkAvailability", availabilityInput().data);
  assert.deepEqual(envelope.requiredKeys, ["room_count", "room_1_number", "room_1_price_per_night"]);
  assert.equal(envelope.facts.find((fact) => fact.key === "room_1_number")?.value, "101");
  assert.equal(envelope.facts.find((fact) => fact.key === "room_1_type")?.value, "DOBLE");
});

test("LLM responder writes natural prose while Core hydrates authoritative placeholders", async () => {
  const responder = new LLMGroundedResponder(provider({
    text: "Sí, encontré {{room_count}} opción disponible. Es la habitación {{room_1_number}} ({{room_1_type}}), a {{room_1_price_per_night}} por noche. Si querés, seguimos con esa.",
  }));
  const message = await responder.compose(availabilityInput());
  assert.match(message, /Sí, encontré 1 opción/i);
  assert.match(message, /habitación 101/i);
  assert.match(message, /DOBLE/);
  assert.match(message, /\$250/);
  assert.doesNotMatch(message, /\{\{/);
});

test("unsupported hotel claims invalidate model draft and fall back deterministically", async () => {
  const responder = new LLMGroundedResponder(provider({
    text: "Encontré {{room_count}} opción: habitación {{room_1_number}} a {{room_1_price_per_night}} por noche, con desayuno incluido.",
  }));
  const message = await responder.compose(availabilityInput());
  assert.match(message, /habitación 101/i);
  assert.match(message, /\$250/);
  assert.doesNotMatch(message, /desayuno/i);
});

test("raw operational values or unknown placeholders cannot bypass grounded hydration", async () => {
  const raw = new LLMGroundedResponder(provider({
    text: "Encontré {{room_count}} opción: habitación 999 a $1 por noche y {{room_1_number}} cuesta {{room_1_price_per_night}}.",
  }));
  const unknown = new LLMGroundedResponder(provider({
    text: "Encontré {{room_count}} opción: {{invented_room}} y {{room_1_number}} cuesta {{room_1_price_per_night}}.",
  }));
  assert.doesNotMatch(await raw.compose(availabilityInput()), /999|\$1\b/);
  assert.doesNotMatch(await unknown.compose(availabilityInput()), /invented_room/);
});

test("greeting can be naturally model-generated without capability-menu behavior", async () => {
  const responder = new LLMGroundedResponder(provider({ text: "¡Hola! Buenas, decime en qué te puedo ayudar." }));
  const message = await responder.compose({
    kind: "message",
    purpose: "greeting",
    baseMessage: "¡Hola! Claro, decime en qué te puedo ayudar.",
    userMessage: "Hola",
    conversation: [],
    context,
  });
  assert.equal(message, "¡Hola! Buenas, decime en qué te puedo ayudar.");
  assert.doesNotMatch(message, /disponibilidad, cotizaciones/i);
});

test("clarification rewriting may ask only for the server-declared missing field", async () => {
  const good = new LLMGroundedResponder(provider({ text: "Perfecto. ¿Para cuántas personas sería?" }));
  const bad = new LLMGroundedResponder(provider({ text: "Perfecto. ¿Para cuántas personas y para qué fechas sería?" }));
  const input = {
    kind: "message",
    purpose: "clarification",
    baseMessage: "¿Para cuántas personas sería?",
    userMessage: "Del 15 al 17 de enero",
    missing: ["guests"],
    conversation: [],
    context,
  };
  assert.equal(await good.compose(input), "Perfecto. ¿Para cuántas personas sería?");
  assert.equal(await bad.compose(input), "¿Para cuántas personas sería?");
});

test("provider failure falls back to deterministic grounded rendering", async () => {
  const failed = new LLMGroundedResponder(provider(undefined, new Error("down")));
  const input = { toolId: "hms.getQuote", data: { nights: 2, totalCents: 50000 }, conversation: [], context };
  assert.match(await failed.compose(input), /\$500/);
});