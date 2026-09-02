import test from "node:test";
import assert from "node:assert/strict";
import { LLMModelRouter } from "../dist/core/llm-model.js";
import { ModelProviderError } from "../dist/core/model-provider.js";
import { InMemoryUsageSink } from "../dist/core/usage.js";

const context = {
  requestId: "req-r28-repair-provider",
  tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: ["hms.checkAvailability"] },
  actor: { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.availability.read"] },
  session: { id: "session-r28-repair-provider", tenantId: "hotel-demo", actorId: "visitor-demo", channel: "webchat", createdAt: "2026-09-02T16:00:00.000Z", expiresAt: "2026-09-02T18:00:00.000Z" },
  now: "2026-09-02T17:00:00.000Z",
};

const tools = [{
  id: "hms.checkAvailability",
  primitive: "CHECK",
  description: "availability",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { checkIn: { type: "string" }, checkOut: { type: "string" }, guests: { type: "integer" } },
    required: ["checkIn", "checkOut", "guests"],
  },
}];

test("R2.8.4 fresh Codex P2: repair provider failure keeps bounded failureCategory on fallback telemetry", async () => {
  const usage = new InMemoryUsageSink();
  let calls = 0;
  const provider = {
    async completeStructured() {
      calls += 1;
      if (calls === 1) {
        return {
          value: {
            kind: "tool",
            toolId: "hms.checkAvailability",
            input: {},
            clarificationReason: "missing",
            missing: ["dates"],
            statePatch: {},
          },
          model: "test-model",
          inputTokens: 20,
          outputTokens: 10,
          latencyMs: 5,
        };
      }
      throw new ModelProviderError("private repair upstream detail", "CloudflareError3036");
    },
  };
  const fallback = { async route() { return { kind: "message", message: "fallback" }; } };
  const router = new LLMModelRouter(provider, fallback, usage);

  const result = await router.route("consulta", context, tools);

  assert.equal(result.kind, "message");
  assert.equal(calls, 2);
  assert.deepEqual(usage.events.map((event) => event.kind), ["model_inference", "model_fallback"]);
  assert.equal(usage.events[1].fallbackReason, "invalid_tool_plan_shape");
  assert.equal(usage.events[1].failureCategory, "CloudflareError3036");
  assert.equal(JSON.stringify(usage.events).includes("private repair upstream detail"), false);
});
