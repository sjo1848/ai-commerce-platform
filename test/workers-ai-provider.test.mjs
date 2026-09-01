import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORKERS_AI_MODEL,
  R2_6_CANDIDATE_MODEL,
  WorkersAiModelProvider,
} from "../dist/adapters/cloudflare-workers-ai.js";

const request = {
  messages: [{ role: "user", content: "hola" }],
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  label: "provider_test",
};

function meteredAi(calls = []) {
  return {
    aiGatewayLogId: "log-123",
    async run(model, input, options) {
      calls.push({ model, input, options });
      return { response: { ok: true }, usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } };
    },
  };
}

test("Workers AI provider meters current default model and routes through AI Gateway", async () => {
  const calls = [];
  const provider = new WorkersAiModelProvider(meteredAi(calls));
  const result = await provider.completeStructured(request);
  assert.equal(provider.model, DEFAULT_WORKERS_AI_MODEL);
  assert.equal(provider.maxRetries, 0);
  assert.equal(result.estimatedCostUsd, 0.293 + 2.253);
  assert.equal(result.logId, "log-123");
  assert.equal(calls[0].options.gateway.id, "default");
  assert.equal(calls[0].options.gateway.skipCache, true);
  assert.equal(calls[0].options.gateway.collectLog, true);
  assert.equal(calls[0].options.gateway.metadata.label, "provider_test");
});

test("R2.6 candidate uses its explicit Cloudflare pricing snapshot", async () => {
  const calls = [];
  const provider = new WorkersAiModelProvider(meteredAi(calls), { model: R2_6_CANDIDATE_MODEL });
  const result = await provider.completeStructured(request);
  assert.equal(provider.model, "@cf/openai/gpt-oss-20b");
  assert.equal(result.estimatedCostUsd, 0.2 + 0.3);
  assert.equal(calls[0].model, R2_6_CANDIDATE_MODEL);
});

test("unknown model never borrows stale pricing from the default model", async () => {
  const provider = new WorkersAiModelProvider(meteredAi(), { model: "@cf/example/future-model" });
  const result = await provider.completeStructured(request);
  assert.equal(result.estimatedCostUsd, undefined);
});

test("custom model can supply explicit pricing without changing Core", async () => {
  const provider = new WorkersAiModelProvider(meteredAi(), {
    model: "@cf/example/custom",
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 2.5,
  });
  const result = await provider.completeStructured(request);
  assert.equal(result.estimatedCostUsd, 3.75);
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

test("Workers AI provider exposes only known public Cloudflare error codes as diagnostic categories", async () => {
  const ai = {
    async run() {
      throw new Error("private upstream detail: account limit reached (code 3036), token=do-not-log");
    },
  };
  const provider = new WorkersAiModelProvider(ai);
  await assert.rejects(
    provider.completeStructured(request),
    (error) => {
      assert.equal(error?.name, "ModelProviderError");
      assert.equal(error?.causeName, "CloudflareError3036");
      assert.equal(error?.message, "Workers AI inference failed");
      assert.doesNotMatch(error?.message ?? "", /token=|private upstream/i);
      return true;
    },
  );
});

test("Workers AI provider preserves only a structured AiError internal code, never its description", async () => {
  const ai = {
    async run() {
      const error = new Error("private upstream detail token=do-not-log");
      error.name = "AiError";
      error.internalCode = 5006;
      error.httpCode = 400;
      error.description = "private schema diagnostic token=do-not-log";
      throw error;
    },
  };
  const provider = new WorkersAiModelProvider(ai);
  await assert.rejects(
    provider.completeStructured(request),
    (error) => {
      assert.equal(error?.name, "ModelProviderError");
      assert.equal(error?.causeName, "CloudflareAiError5006");
      assert.equal(error?.message, "Workers AI inference failed");
      assert.doesNotMatch(error?.message ?? "", /token=|private|schema diagnostic/i);
      return true;
    },
  );
});

test("Workers AI provider falls back to a bounded AiError HTTP category when internal code is unavailable", async () => {
  const ai = {
    async run() {
      const error = new Error("private upstream detail token=do-not-log");
      error.name = "AiError";
      error.httpCode = 429;
      error.description = "private capacity diagnostic token=do-not-log";
      throw error;
    },
  };
  const provider = new WorkersAiModelProvider(ai);
  await assert.rejects(
    provider.completeStructured(request),
    (error) => {
      assert.equal(error?.name, "ModelProviderError");
      assert.equal(error?.causeName, "CloudflareAiHttp429");
      assert.equal(error?.message, "Workers AI inference failed");
      assert.doesNotMatch(error?.message ?? "", /token=|private|capacity diagnostic/i);
      return true;
    },
  );
});

test("Workers AI provider maps the public daily-allocation AiError wording without exposing provider text", async () => {
  const ai = {
    async run() {
      const error = new Error("AiError");
      error.name = "AiError";
      error.httpCode = 429;
      error.description = "You have used up your daily free allocation of 10,000 neurons. token=do-not-log";
      throw error;
    },
  };
  const provider = new WorkersAiModelProvider(ai);
  await assert.rejects(
    provider.completeStructured(request),
    (error) => {
      assert.equal(error?.name, "ModelProviderError");
      assert.equal(error?.causeName, "CloudflareError3036");
      assert.equal(error?.message, "Workers AI inference failed");
      assert.doesNotMatch(error?.message ?? "", /token=|daily free allocation|neurons/i);
      return true;
    },
  );
});

test("invalid timeout configuration fails at construction", () => {
  const ai = { async run() { return { response: { ok: true } }; } };
  assert.throws(() => new WorkersAiModelProvider(ai, { timeoutMs: 100 }), /timeout must be between/i);
  assert.throws(() => new WorkersAiModelProvider(ai, { timeoutMs: 31_000 }), /timeout must be between/i);
});
