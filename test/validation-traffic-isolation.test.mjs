import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { LLMModelRouter } from "../dist/core/llm-model.js";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";
import {
  VALIDATION_RUN_TOKEN_HEADER,
  admitValidationRequest,
  parseValidationConfiguration,
  validationAdmission,
} from "../dist/validation-admission.js";

const token = "server-owned-validation-token";
const budget = {
  maxNeuronsPerRun: 300,
  configuredAvailableBudget: 300,
  configuredReserve: 0,
  conservativeExpectedCost: 180,
};
const configured = {
  ACP_VALIDATION_NEURON_BUDGET: JSON.stringify(budget),
  ACP_VALIDATION_EXPERIMENT_ID: "validation-experiment",
  ACP_VALIDATION_RUN_TOKEN: token,
};
const request = (headers = {}, body = "{}") => new Request("https://example.test/api/chat", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body,
});

async function rejected(config, headers = { [VALIDATION_RUN_TOKEN_HEADER]: token }) {
  let calls = 0;
  const response = await admitValidationRequest(request(headers), config, async () => {
    calls += 1;
    return new Response("unexpected");
  });
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Forbidden");
  assert.equal(calls, 0);
}

test("A: absent validation configuration preserves the normal request path", async () => {
  const inbound = request({ [VALIDATION_RUN_TOKEN_HEADER]: "ordinary-header-value" });
  let forwarded;
  const response = await admitValidationRequest(inbound, {}, async (value) => {
    forwarded = value;
    return new Response("ok");
  });
  assert.equal(response.status, 200);
  assert.strictEqual(forwarded, inbound);
  assert.equal(forwarded.headers.get(VALIDATION_RUN_TOKEN_HEADER), "ordinary-header-value");
  assert.deepEqual(parseValidationConfiguration({}), { status: "disabled" });
  assert.deepEqual(validationAdmission({}), { active: false });
});

test("validation-only denials may add an immutable identity response header without changing disabled or admitted traffic", async () => {
  const version = "immutable-worker-version";
  const denied = await admitValidationRequest(request(), configured, async () => new Response("unexpected"), () => new Response("Forbidden", { status: 403, headers: { "x-acp-validation-runtime-version": version } }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("x-acp-validation-runtime-version"), version);

  const disabled = await admitValidationRequest(request(), {}, async () => new Response("normal"), () => new Response("unexpected", { headers: { "x-acp-validation-runtime-version": version } }));
  assert.equal(disabled.headers.get("x-acp-validation-runtime-version"), null);

  const admitted = await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: token }), configured, async () => new Response("admitted"), () => new Response("unexpected", { headers: { "x-acp-validation-runtime-version": version } }));
  assert.equal(admitted.headers.get("x-acp-validation-runtime-version"), null);
});

test("B: whitespace-only budget fails closed before downstream", () => rejected({ ...configured, ACP_VALIDATION_NEURON_BUDGET: " \t " }));
test("C: malformed JSON budget fails closed before downstream", () => rejected({ ...configured, ACP_VALIDATION_NEURON_BUDGET: "{" }));
test("D: JSON array budget fails closed before downstream", () => rejected({ ...configured, ACP_VALIDATION_NEURON_BUDGET: "[]" }));
test("E: empty JSON object budget fails closed before downstream", () => rejected({ ...configured, ACP_VALIDATION_NEURON_BUDGET: "{}" }));
test("F: a budget missing any required field fails closed before downstream", async () => {
  for (const missing of Object.keys(budget)) {
    const partialBudget = { ...budget };
    delete partialBudget[missing];
    await rejected({ ...configured, ACP_VALIDATION_NEURON_BUDGET: JSON.stringify(partialBudget) });
  }
});

test("G: negative, non-finite, and non-number budget fields fail closed", async () => {
  for (const invalid of [-1, "1", null]) {
    await rejected({ ...configured, ACP_VALIDATION_NEURON_BUDGET: JSON.stringify({ ...budget, configuredReserve: invalid }) });
  }
  await rejected({ ...configured, ACP_VALIDATION_NEURON_BUDGET: '{"maxNeuronsPerRun":300,"configuredAvailableBudget":300,"configuredReserve":1e999,"conservativeExpectedCost":180}' });
  assert.deepEqual(parseValidationConfiguration({ ...configured, ACP_VALIDATION_NEURON_BUDGET: JSON.stringify({ ...budget, observedLocalDayNeurons: -1 }) }), { status: "invalid" });
});

test("H: every partial validation configuration fails closed", async () => {
  for (const missing of Object.keys(configured)) {
    const partial = { ...configured };
    delete partial[missing];
    await rejected(partial);
    assert.deepEqual(validationAdmission(partial), { active: true }, missing);
  }
});

test("I: budget without experiment ID and experiment ID without budget fail closed", async () => {
  await rejected({ ACP_VALIDATION_NEURON_BUDGET: configured.ACP_VALIDATION_NEURON_BUDGET, ACP_VALIDATION_RUN_TOKEN: token });
  await rejected({ ACP_VALIDATION_EXPERIMENT_ID: configured.ACP_VALIDATION_EXPERIMENT_ID, ACP_VALIDATION_RUN_TOKEN: token });
});

test("J: invalid experiment IDs and empty validation tokens fail closed", async () => {
  await rejected({ ...configured, ACP_VALIDATION_EXPERIMENT_ID: "not allowed" });
  await rejected({ ...configured, ACP_VALIDATION_RUN_TOKEN: " " });
});

test("K: complete configuration rejects a missing credential generically", () => rejected(configured, {}));
test("L: complete configuration rejects a wrong credential without reflecting it", async () => {
  const wrong = "wrong-token";
  const response = await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: wrong }), configured, async () => new Response("unexpected"));
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), new RegExp(wrong));
});

test("M: complete configuration and correct credential invoke the existing path exactly once", async () => {
  let calls = 0;
  const response = await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: token }), configured, async () => {
    calls += 1;
    return new Response("existing-path");
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "existing-path");
  assert.equal(calls, 1);
});

test("N: admitted traffic strips the credential before Core", async () => {
  let forwarded;
  await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: token, "x-safe": "kept" }), configured, async (value) => {
    forwarded = value;
    return new Response("ok");
  });
  assert.equal(forwarded.headers.get(VALIDATION_RUN_TOKEN_HEADER), null);
  assert.equal(forwarded.headers.get("x-safe"), "kept");
});

test("O: rejected traffic performs zero construction, provider, reserve, HMS, and approval work", async () => {
  const counters = { construction: 0, provider: 0, reserve: 0, hms: 0, approval: 0 };
  const response = await admitValidationRequest(request(), { ...configured, ACP_VALIDATION_NEURON_BUDGET: "{" }, async () => {
    counters.construction += 1;
    counters.provider += 1;
    counters.reserve += 1;
    counters.hms += 1;
    counters.approval += 1;
    return new Response("unexpected");
  });
  assert.equal(response.status, 403);
  assert.deepEqual(counters, { construction: 0, provider: 0, reserve: 0, hms: 0, approval: 0 });
});

test("P: token and configuration never enter fake prompts, logs, or telemetry", async () => {
  const observed = { prompt: "", logs: [], telemetry: [] };
  await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: token }, JSON.stringify({ message: "hola" })), configured, async (value) => {
    observed.prompt = await value.text();
    observed.logs.push(JSON.stringify([...value.headers]));
    observed.telemetry.push(JSON.stringify({ headers: [...value.headers] }));
    return new Response("ok");
  });
  const serialized = JSON.stringify(observed);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(configured.ACP_VALIDATION_NEURON_BUDGET), false);
});

async function promptFor(headers, config = configured) {
  let system = "";
  const router = new LLMModelRouter({ async completeStructured(value) {
    system = value.messages[0].content;
    return { value: { kind: "message", toolId: "", input: {}, clarificationReason: "acknowledgement", missing: [], statePatch: {}, mutationGrounding: null } };
  } }, { async route() { return { kind: "message", message: "fallback" }; } });
  await admitValidationRequest(request(headers, JSON.stringify({ message: "Somos dos, ¿qué hay?" })), config, async (value) => {
    const { message } = await value.json();
    await router.route(message, { now: "2026-08-30T14:00:00.000Z", tenant: { id: "hotel-demo" }, session: { id: "golden-session" } }, [{ id: "hms.checkAvailability", description: "availability", risk: "read", inputSchema: { type: "object", properties: {}, required: [] } }], [], { stay: { guests: 2 }, availabilityRoomIds: [], availabilityRooms: [], selectedRoomIds: [], roomOccupancy: [] });
    return new Response("ok");
  });
  return system;
}

test("Q: prompt golden is unchanged and fallback remains unable to authorize a natural-language write", async () => {
  const admitted = await promptFor({ [VALIDATION_RUN_TOKEN_HEADER]: token });
  const normal = await promptFor({}, {});
  assert.equal(admitted, normal);
  assert.equal(Buffer.byteLength(admitted), 11273);
  assert.equal(createHash("sha256").update(admitted).digest("hex"), "2d31c902167ef607b58b00545044a5a10c9d66e7ee568844d6af38a597e08dc9");
  const result = await new DeterministicModelRouter().route("reservar la habitación 101 del 2034-02-10 al 2034-02-12", { now: "2026-08-30T14:00:00.000Z", tenant: { id: "hotel-demo" }, session: { id: "regression-session" } }, [{ id: "hms.createReservation", description: "create", risk: "write", inputSchema: { type: "object", properties: {}, required: [] } }]);
  assert.equal(result.kind, "message");
  assert.equal("plan" in result, false);
});
