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
    properties: {
      checkIn: { type: "string" },
      checkOut: { type: "string" },
      guests: { type: "integer" },
    },
    required: ["checkIn", "checkOut", "guests"],
  },
}];

function fallback(result = { kind: "message", message: "fallback" }) {
  return {
    calls: 0,
    async route() { this.calls += 1; return result; },
  };
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

test("LLM router accepts a visible tool with schema-bounded business arguments", async () => {
  const p = provider({
    kind: "tool",
    toolId: "hms.checkAvailability",
    input: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2 },
    message: "",
  });
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  const result = await router.route("Somos dos del 10 al 12 de febrero de 2034", context, tools);
  assert.deepEqual(result, {
    kind: "tool",
    plan: { toolId: "hms.checkAvailability", input: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2 } },
  });
  assert.equal(fb.calls, 0);
  const prompt = p.request.messages.map((item) => item.content).join("\n");
  assert.doesNotMatch(prompt, /tenant-secret|actor-secret|session-secret|request-secret/);
  assert.match(prompt, /hms\.checkAvailability/);
});

test("LLM router accepts a concise clarification message", async () => {
  const p = provider({ kind: "message", toolId: "", input: {}, message: "¿Para qué fechas sería?" });
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  assert.deepEqual(await router.route("¿Tenés para dos?", context, tools), { kind: "message", message: "¿Para qué fechas sería?" });
  assert.equal(fb.calls, 0);
});

test("unknown model-selected tools fail to configured fallback", async () => {
  const p = provider({ kind: "tool", toolId: "hms.deleteHotel", input: {}, message: "" });
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  assert.deepEqual(await router.route("borrá el hotel", context, tools), { kind: "message", message: "fallback" });
  assert.equal(fb.calls, 1);
});

test("trusted execution fields from model output are rejected", async () => {
  const p = provider({
    kind: "tool",
    toolId: "hms.checkAvailability",
    input: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2, tenantId: "other" },
    message: "",
  });
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
  assert.deepEqual(await router.route("consulta", context, tools), { kind: "message", message: "fallback" });
  assert.equal(fb.calls, 1);
});

test("guestId and traceId are globally trusted even for a schema-less future tool", async () => {
  const schemaLess = [{ id: "future.tool", primitive: "CHECK", description: "future", risk: "read" }];
  for (const field of ["guestId", "traceId"]) {
    const p = provider({ kind: "tool", toolId: "future.tool", input: { query: "x", [field]: "attacker" }, message: "" });
    const fb = fallback();
    const router = new LLMModelRouter(p, fb);
    assert.deepEqual(await router.route("consulta", context, schemaLess), { kind: "message", message: "fallback" });
    assert.equal(fb.calls, 1);
  }
});

test("unknown tool arguments are rejected before executor", async () => {
  const p = provider({
    kind: "tool",
    toolId: "hms.checkAvailability",
    input: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2, surprise: "x" },
    message: "",
  });
  const fb = fallback();
  const router = new LLMModelRouter(p, fb);
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
