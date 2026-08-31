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

function manyRoomsInput() {
  return {
    toolId: "hms.checkAvailability",
    data: {
      rooms: Array.from({ length: 7 }, (_, index) => ({
        roomNumber: String(101 + index),
        roomType: "DOBLE",
        priceCents: 25000 + index * 1000,
      })),
    },
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

test("availability envelope preserves total count when only five room details are exposed", () => {
  const envelope = buildGroundedFactEnvelope("hms.checkAvailability", manyRoomsInput().data);
  assert.equal(envelope.facts.find((fact) => fact.key === "room_count")?.value, "7");
  assert.equal(envelope.facts.find((fact) => fact.key === "shown_room_count")?.value, "5");
  assert.equal(envelope.facts.some((fact) => fact.key === "room_6_number"), false);
  assert.ok(envelope.requiredKeys.includes("shown_room_count"));
});

test("truncated natural availability must disclose that only a subset is shown", async () => {
  const good = new LLMGroundedResponder(provider({
    text: "Hay {{room_count}} opciones disponibles. Te muestro las primeras {{shown_room_count}}: {{room_1_number}} a {{room_1_price_per_night}}, {{room_2_number}} a {{room_2_price_per_night}}, {{room_3_number}} a {{room_3_price_per_night}}, {{room_4_number}} a {{room_4_price_per_night}} y {{room_5_number}} a {{room_5_price_per_night}}.",
  }));
  const bad = new LLMGroundedResponder(provider({
    text: "Hay {{room_count}} opciones disponibles: {{shown_room_count}}, {{room_1_number}} a {{room_1_price_per_night}}, {{room_2_number}} a {{room_2_price_per_night}}, {{room_3_number}} a {{room_3_price_per_night}}, {{room_4_number}} a {{room_4_price_per_night}} y {{room_5_number}} a {{room_5_price_per_night}}.",
  }));
  const goodMessage = await good.compose(manyRoomsInput());
  assert.match(goodMessage, /Hay 7 opciones/i);
  assert.match(goodMessage, /muestro las primeras 5/i);
  const badMessage = await bad.compose(manyRoomsInput());
  assert.match(badMessage, /Encontré 7 opciones disponibles/i);
  assert.match(badMessage, /primeras 5/i);
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

test("invented qualitative room claims invalidate model draft", async () => {
  const responder = new LLMGroundedResponder(provider({
    text: "Encontré {{room_count}} opción. La habitación {{room_1_number}} es amplia y silenciosa, a {{room_1_price_per_night}} por noche.",
  }));
  const message = await responder.compose(availabilityInput());
  assert.match(message, /habitación 101/i);
  assert.match(message, /\$250/);
  assert.doesNotMatch(message, /amplia|silenciosa/i);
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