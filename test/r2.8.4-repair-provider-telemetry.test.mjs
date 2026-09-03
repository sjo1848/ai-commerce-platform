import test from "node:test";
import assert from "node:assert/strict";
import { LLMModelRouter } from "../dist/core/llm-model.js";
import { InMemoryUsageSink } from "../dist/core/usage.js";

test("R2.8.4 repair provider failure preserves bounded category and no-write fallback", async () => {
  let calls = 0;
  const provider = { async completeStructured() { calls += 1; if (calls === 1) return { value: { kind: "tool", toolId: "hms.createReservation", input: {}, clarificationReason: "missing", missing: ["selection"], statePatch: {} } }; const error = new Error("private provider detail"); error.name = "AiError"; error.internalCode = "3036"; throw error; } };
  const usage = new InMemoryUsageSink();
  const fallback = { async route() { return { kind: "tool", plan: { toolId: "hms.createReservation", input: {} }, statePatch: { selectedRoomId: "secret" } }; } };
  const router = new LLMModelRouter(provider, fallback, usage);
  const context = { requestId: "r", tenant: { id: "t", slug: "t", status: "active", allowedToolIds: ["hms.createReservation"] }, actor: { id: "a", type: "customer", roles: [], permissions: [] }, session: { id: "s", tenantId: "t", actorId: "a", channel: "webchat", createdAt: "2030-01-01", expiresAt: "2030-01-02" }, now: "2030-01-01" };
  const result = await router.route("reservá", context, [{ id: "hms.createReservation", primitive: "RESERVE", risk: "write", description: "reserve" }]);
  assert.equal(calls, 2); assert.equal(result.kind, "message"); assert.equal(Object.hasOwn(result, "plan"), false); assert.equal(Object.hasOwn(result, "statePatch"), false);
  const fallbackEvent = usage.events.find((event) => event.kind === "model_fallback");
  assert.equal(fallbackEvent.failureCategory, "AiError"); assert.doesNotMatch(JSON.stringify(fallbackEvent), /private provider detail|3036.*private/i);
});
