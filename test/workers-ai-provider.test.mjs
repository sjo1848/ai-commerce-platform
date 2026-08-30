import assert from "node:assert/strict";
import test from "node:test";
import { WorkersAiModelProvider } from "../dist/adapters/cloudflare-workers-ai.js";

const request = {
  messages: [{ role: "user", content: "hola" }],
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  label: "provider_test",
};

test("Workers AI provider meters current default model and routes through AI Gateway", async () => {
  const calls = [];
  const ai = {
    aiGatewayLogId: "log-123",
    async run(model, input, options) {
      calls.push({ model, input, options });
      return { response: { ok: true }, usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } };
    },
  };
  const provider = new WorkersAiModelProvider(ai);
  const result = await provider.completeStructured(request);
  assert.equal(provider.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(provider.maxRetries, 0);
  assert.equal(result.estimatedCostUsd, 0.293 + 2.253);
  assert.equal(result.logId, "log-123");
  assert.equal(calls[0].options.gateway.id, "default");
  assert.equal(calls[0].options.gateway.skipCache, true);
  assert.equal(calls[0].options.gateway.collectLog, true);
  assert.equal(calls[0].options.gateway.metadata.label, "provider_test");
});

test("Workers AI provider times out without automatic retry", async () => {
  let calls = 0;
  const ai = {
    async run() {
      calls += 1;
      return new Promise(() => {});
    },
  };
  const provider = new WorkersAiModelProvider(ai, { timeoutMs: 250 });
  const started = Date.now();
  await assert.rejects(
    provider.completeStructured(request),
    (error) => error?.name === "ModelProviderError" && error?.causeName === "TimeoutError",
  );
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 1_500);
});

test("invalid timeout configuration fails at construction", () => {
  const ai = { async run() { return { response: { ok: true } }; } };
  assert.throws(() => new WorkersAiModelProvider(ai, { timeoutMs: 100 }), /timeout must be between/i);
  assert.throws(() => new WorkersAiModelProvider(ai, { timeoutMs: 31_000 }), /timeout must be between/i);
});
