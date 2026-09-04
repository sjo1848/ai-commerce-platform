import test from "node:test";
import assert from "node:assert/strict";
import { LLMModelRouter } from "../dist/core/llm-model.js";

const context = {
  requestId: "request-secret",
  tenant: { id: "tenant-secret", slug: "hotel-demo", status: "active", allowedToolIds: ["hms.checkAvailability"] },
  actor: { id: "actor-secret", type: "customer", roles: ["customer"], permissions: ["hms.availability.read"] },
  session: { id: "session-secret", tenantId: "tenant-secret", actorId: "actor-secret", channel: "webchat", createdAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z" },
  now: "2026-08-30T13:00:00.000Z",
};

const tools = [{
  id: "hms.checkAvailability",
  primitive: "CHECK",
  description: "Consulta disponibilidad real.",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { checkIn: { type: "string" }, checkOut: { type: "string" }, guests: { type: "integer" } },
    required: ["checkIn", "checkOut", "guests"],
  },
}];

function fallback(result = { kind: "message", message: "fallback" }) {
  return { calls: 0, async route() { this.calls += 1; return result; } };
}
function provider(value, error) {
  return {
    request: undefined,
    async completeStructured(request) {
      this.request = request;
      if (error) throw error;
      return { value, model: "fake" };
    },
  };
}
function toolRoute(input, toolId = "hms.checkAvailability", statePatch = {}) {
  return { kind: "tool", toolId, input, clarificationReason: "none", missing: [], statePatch };
}
function messageRoute(reason, missing, statePatch = {}) {
  return { kind: "message", toolId: "", input: {}, clarificationReason: reason, missing, statePatch, mutationGrounding: null };
}

test("LLM router accepts a visible tool with schema-bounded business arguments", async () => {
  const p = provider(toolRoute({ checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2 }));
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  const result = await router.route("Somos dos del 10 al 12 de febrero de 2034", context, tools);
  assert.deepEqual(result, {
    kind: "tool",
    plan: { toolId: "hms.checkAvailability", input: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2 } },
    statePatch: {}, mutationGrounding: null,
  });
  assert.equal(fb.calls, 0);
  const prompt = p.request.messages.map((item) => item.content).join("\n");
  assert.doesNotMatch(prompt, /tenant-secret|actor-secret|session-secret|request-secret/);
  assert.match(prompt, /hms\.checkAvailability/);
  assert.match(prompt, /CURRENT_CONVERSATION_STATE=/);
});

test("LLM router accepts a one-based ordinal selection as state, not as a room id", async () => {
  const quoteTools = [{
    id: "hms.getQuote", primitive: "QUOTE", description: "quote", risk: "read",
    inputSchema: { type: "object", additionalProperties: false, properties: { roomId: {}, checkIn: {}, checkOut: {} }, required: ["roomId", "checkIn", "checkOut"] },
  }];
  const p = provider(toolRoute({}, "hms.getQuote", { selectedRoomIndex: 2 }));
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  const result = await router.route("¿Cuánto sale la segunda?", context, quoteTools, [], {
    stay: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2 },
    availabilityRoomIds: ["room-a", "room-b"],
  });
  assert.deepEqual(result, { kind: "tool", plan: { toolId: "hms.getQuote", input: {} }, statePatch: { selectedRoomIndex: 2 }, mutationGrounding: null });
  assert.equal(fb.calls, 0);
  assert.match(p.request.messages[0].content, /ONE-BASED list position/i);
});

test("LLM router converts structured missing-field decision into bounded clarification metadata", async () => {
  const p = provider(messageRoute("missing", ["dates"]));
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  assert.deepEqual(await router.route("¿Tenés para dos?", context, tools), {
    kind: "message",
    message: "¿Para qué fechas sería?",
    purpose: "clarification",
    missing: ["dates"],
    statePatch: {}, mutationGrounding: null,
  });
  assert.equal(fb.calls, 0);
});

test("LLM message route cannot author free-form operational facts", async () => {
  const p = provider({ ...messageRoute("missing", ["dates"]), message: "Sí, hay una suite por $1 con desayuno" });
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  const result = await router.route("¿Tenés algo?", context, tools);
  assert.deepEqual(result, { kind: "message", message: "fallback" });
  assert.equal(fb.calls, 1);
  assert.doesNotMatch(result.message, /suite|desayuno|\$1/i);
});

test("unknown model-selected tools fail to configured fallback", async () => {
  const p = provider(toolRoute({}, "hms.deleteHotel"));
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  assert.deepEqual(await router.route("borrá el hotel", context, tools), { kind: "message", message: "fallback" });
  assert.equal(fb.calls, 1);
});

test("trusted execution fields from model output are rejected", async () => {
  const p = provider(toolRoute({ checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2, tenantId: "other" }));
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  assert.deepEqual(await router.route("consulta", context, tools), { kind: "message", message: "fallback" });
  assert.equal(fb.calls, 1);
});

test("model statePatch cannot mutate or clear server-owned active booking grounding", async () => {
  for (const activeBookingId of [null, "forged-booking"]) {
    const p = provider(toolRoute(
      { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2 },
      "hms.checkAvailability",
      { activeBookingId },
    ));
    const fb = fallback();
    const router = new LLMModelRouter(p, fb);
    assert.deepEqual(await router.route("consulta", context, tools), { kind: "message", message: "fallback" });
    assert.equal(fb.calls, 1);
  }
});

test("guestId and traceId are globally trusted even for a schema-less future tool", async () => {
  const schemaLess = [{ id: "future.tool", primitive: "CHECK", description: "future", risk: "read" }];
  for (const field of ["guestId", "traceId"]) {
    const p = provider(toolRoute({ query: "x", [field]: "attacker" }, "future.tool"));
    const fb = fallback();
    const router = new LLMModelRouter(p, fb);
    assert.deepEqual(await router.route("consulta", context, schemaLess), { kind: "message", message: "fallback" });
    assert.equal(fb.calls, 1);
  }
});

test("unknown tool arguments are rejected before executor", async () => {
  const p = provider(toolRoute({ checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2, surprise: "x" }));
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  assert.deepEqual(await router.route("consulta", context, tools), { kind: "message", message: "fallback" });
  assert.equal(fb.calls, 1);
});

test("inconsistent message/tool clarification state fails to fallback", async () => {
  const fb = fallback();
  const router = new LLMModelRouter(provider({ kind: "message", toolId: "hms.checkAvailability", input: {}, clarificationReason: "missing", missing: ["dates"], statePatch: {} }), fb);
  assert.deepEqual(await router.route("consulta", context, tools), { kind: "message", message: "fallback" });
  assert.equal(fb.calls, 1);
});

test("provider failure degrades to deterministic fallback without changing policy", async () => {
  const p = provider(undefined, new Error("model unavailable"));
  const fb = fallback({ kind: "tool", plan: { toolId: "hms.checkAvailability", input: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 1 } } });
  const router = new LLMModelRouter(p, fb);
  const result = await router.route("disponibilidad 2034-02-10 2034-02-12 para 1 persona", context, tools);
  assert.equal(result.kind, "tool");
  assert.equal(fb.calls, 1);
});

test("LLM cannot ask again for dates already present in durable state", async () => {
  const p = provider(messageRoute("missing", ["dates"], { guests: 2 }));
  const fb = fallback({ kind: "tool", plan: { toolId: "hms.checkAvailability", input: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2 } } });
  const router = new LLMModelRouter(p, fb);
  const result = await router.route("Somos dos", context, tools, [], { stay: { checkIn: "2034-02-10", checkOut: "2034-02-12" }, availabilityRoomIds: [] });
  assert.equal(result.kind, "tool");
  assert.equal(fb.calls, 1);
});
