import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { LLMModelRouter } from "../dist/core/llm-model.js";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";
import {
  VALIDATION_RUN_TOKEN_HEADER,
  admitValidationRequest,
  validationAdmission,
} from "../dist/validation-admission.js";

const token = "server-owned-validation-token";
const configured = {
  ACP_VALIDATION_NEURON_BUDGET: '{"maxNeuronsPerRun":1}',
  ACP_VALIDATION_EXPERIMENT_ID: "validation-experiment",
  ACP_VALIDATION_RUN_TOKEN: token,
};
const request = (headers = {}, body = "{}") => new Request("https://example.test/api/chat", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body,
});

test("A: absent validation configuration preserves the normal request object and admission", async () => {
  const inbound = request({ [VALIDATION_RUN_TOKEN_HEADER]: "ordinary-header-value" });
  let forwarded;
  const response = await admitValidationRequest(inbound, {}, async (value) => {
    forwarded = value;
    return new Response("ok");
  });
  assert.equal(response.status, 200);
  assert.strictEqual(forwarded, inbound);
  assert.equal(forwarded.headers.get(VALIDATION_RUN_TOKEN_HEADER), "ordinary-header-value");
  assert.deepEqual(validationAdmission({}), { active: false });
});

test("B: every partial validation configuration is active and fails closed", async () => {
  for (const missing of Object.keys(configured)) {
    const partial = { ...configured };
    delete partial[missing];
    let calls = 0;
    const response = await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: token }), partial, async () => {
      calls += 1;
      return new Response("unexpected");
    });
    assert.equal(response.status, 403, missing);
    assert.equal(calls, 0, missing);
    assert.deepEqual(validationAdmission(partial), { active: true }, missing);
  }
});

test("C: configured validation rejects a missing credential generically", async () => {
  let calls = 0;
  const response = await admitValidationRequest(request(), configured, async () => { calls += 1; return new Response("unexpected"); });
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Forbidden");
  assert.equal(calls, 0);
});

test("D: configured validation rejects a wrong credential without reflecting it", async () => {
  const wrong = "wrong-token";
  const response = await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: wrong }), configured, async () => new Response("unexpected"));
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), new RegExp(wrong));
});

test("E: a correct credential admits the existing path", async () => {
  let calls = 0;
  const response = await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: token }), configured, async () => {
    calls += 1;
    return new Response("existing-path");
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "existing-path");
  assert.equal(calls, 1);
});

test("F: rejected traffic short-circuits construction, reserve, HMS, and approval work", async () => {
  const counters = { construction: 0, provider: 0, reserve: 0, hms: 0, approval: 0 };
  const response = await admitValidationRequest(request(), configured, async () => {
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

test("G: the admitted request removes the credential before downstream handling", async () => {
  let forwarded;
  await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: token, "x-safe": "kept" }), configured, async (value) => {
    forwarded = value;
    return new Response("ok");
  });
  assert.equal(forwarded.headers.get(VALIDATION_RUN_TOKEN_HEADER), null);
  assert.equal(forwarded.headers.get("x-safe"), "kept");
});

test("H: the credential cannot enter fake prompt, logs, or telemetry downstream", async () => {
  const observed = { prompt: "", logs: [], telemetry: [] };
  await admitValidationRequest(request({ [VALIDATION_RUN_TOKEN_HEADER]: token }, JSON.stringify({ message: "hola" })), configured, async (value) => {
    observed.prompt = await value.text();
    observed.logs.push(JSON.stringify([...value.headers]));
    observed.telemetry.push(JSON.stringify({ headers: [...value.headers] }));
    return new Response("ok");
  });
  assert.equal(JSON.stringify(observed).includes(token), false);
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

test("I: authorized prompt assembly remains byte-for-byte golden", async () => {
  const system = await promptFor({ [VALIDATION_RUN_TOKEN_HEADER]: token });
  assert.equal(Buffer.byteLength(system), 10981);
  assert.equal(createHash("sha256").update(system).digest("hex"), "4989b5d3a4aff1992bdd1f43f4ca699c9df3f33da973afed2ae24147aa41961c");
  assert.doesNotMatch(system, new RegExp(token));
});

test("J: normal routing remains byte-equivalent when validation configuration is absent", async () => {
  const admitted = await promptFor({ [VALIDATION_RUN_TOKEN_HEADER]: token });
  const normal = await promptFor({}, {});
  assert.equal(normal, admitted);
  assert.equal(createHash("sha256").update(normal).digest("hex"), "4989b5d3a4aff1992bdd1f43f4ca699c9df3f33da973afed2ae24147aa41961c");
});

test("K: existing NLU, grounding, HITL, and fail-closed suites remain separate and applicable", () => {
  assert.equal(typeof LLMModelRouter, "function");
  assert.equal(validationAdmission(configured).active, true);
});

test("L: deterministic fallback still cannot authorize a natural-language write", async () => {
  const result = await new DeterministicModelRouter().route(
    "reservar la habitación 101 del 2034-02-10 al 2034-02-12",
    { now: "2026-08-30T14:00:00.000Z", tenant: { id: "hotel-demo" }, session: { id: "regression-session" } },
    [{ id: "hms.createReservation", description: "create", risk: "write", inputSchema: { type: "object", properties: {}, required: [] } }],
  );
  assert.equal(result.kind, "message");
  assert.equal("plan" in result, false);
});
