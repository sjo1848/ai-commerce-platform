import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";
import { LLMGroundedResponder } from "../dist/core/model-responder.js";

const context = {
  requestId: "r2.6-quality",
  tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: [] },
  actor: { id: "visitor", type: "customer", roles: ["customer"], permissions: [] },
  session: { id: "s", tenantId: "hotel-demo", actorId: "visitor", channel: "webchat", createdAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-09-02T00:00:00.000Z" },
  now: "2026-09-01T00:00:00.000Z",
};

function provider(text) {
  return {
    async completeStructured() {
      return { value: { text } };
    },
  };
}

test("R2.6 fallback asks for dates when availability intent already contains guest count", async () => {
  const router = new DeterministicModelRouter();
  const route = await router.route(
    "¿Tenés habitaciones para dos?",
    context,
    [{
      id: "hms.checkAvailability",
      description: "availability",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          checkIn: { type: "string" },
          checkOut: { type: "string" },
          guests: { type: "number" },
        },
        required: ["checkIn", "checkOut", "guests"],
      },
      risk: "read",
    }],
  );
  assert.equal(route.kind, "message");
  assert.equal(route.purpose, "clarification");
  assert.deepEqual(route.missing, ["dates"]);
  assert.match(route.message, /fecha/i);
});

test("R2.6 acknowledgement cannot invent payment methods or a payment next step", async () => {
  const responder = new LLMGroundedResponder(provider("Perfecto, lo tengo. ¿Quiere pagar con tarjeta de crédito o en efectivo?"));
  const message = await responder.compose({
    kind: "message",
    purpose: "acknowledgement",
    baseMessage: "Perfecto, lo tengo.",
    userMessage: "Quiero las dos primeras habitaciones.",
    conversation: [],
    context,
  });
  assert.equal(message, "Perfecto, lo tengo.");
  assert.doesNotMatch(message, /pagar|tarjeta|efectivo/i);
});

test("R2.6 safe acknowledgement remains eligible for natural model wording", async () => {
  const responder = new LLMGroundedResponder(provider("Perfecto, ya lo tengo."));
  const message = await responder.compose({
    kind: "message",
    purpose: "acknowledgement",
    baseMessage: "Perfecto, lo tengo.",
    userMessage: "Quiero las dos primeras habitaciones.",
    conversation: [],
    context,
  });
  assert.equal(message, "Perfecto, ya lo tengo.");
});
