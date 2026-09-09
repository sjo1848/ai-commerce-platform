import test from "node:test";
import assert from "node:assert/strict";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { LLMModelRouter } from "../dist/core/llm-model.js";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";
import { tenantA } from "./helpers.mjs";

const actor = { id: "visitor-1", type: "customer", roles: ["customer"], permissions: ["hms.availability.read", "hms.quote.read"] };
const route = { kind: "tool", toolId: "hms.checkAvailability", input: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 2 }, clarificationReason: "none", missing: [], statePatch: {} };
const request = () => new Request("https://core.test/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Disponibilidad del 2030-01-01 al 2030-01-03 para 2 personas" }) });

function handler({ fallback = false, expose = true } = {}) {
  const provider = { async completeStructured() { if (fallback) throw new Error("provider unavailable"); return { value: route, model: "server-configured" }; } };
  const model = new LLMModelRouter(provider, new DeterministicModelRouter(), undefined, true);
  return createWebchatHandler(new AgentCoreRuntime({ tenants: [tenantA], model, now: () => new Date("2029-01-01") }), { fixedTenantId: "hotel-a", fixedActorId: actor.id, exposeValidationRouteProvenance: expose });
}

test("validation response carries a minimal server-issued baseline LLM receipt", async () => {
  const body = await (await handler()(request())).json();
  assert.deepEqual(body.validationRouteProvenance, { route: "baseline_llm" });
  assert.deepEqual(Object.keys(body.validationRouteProvenance), ["route"]);
  assert.doesNotMatch(JSON.stringify(body.validationRouteProvenance), /token|experiment|budget|tenant|actor|guest|session|request/i);
});

test("validation response marks deterministic fallback without changing its safe route", async () => {
  const response = await handler({ fallback: true })(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).validationRouteProvenance, { route: "deterministic_fallback" });
});

test("receipt is absent when validation exposure is disabled", async () => {
  const body = await (await handler({ expose: false })(request())).json();
  assert.equal("validationRouteProvenance" in body, false);
});
