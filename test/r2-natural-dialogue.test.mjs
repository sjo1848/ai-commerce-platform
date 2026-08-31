import test from "node:test";
import assert from "node:assert/strict";
import { AgentCoreRuntime } from "../dist/core/runtime.js";

const tenant = {
  id: "hotel-demo",
  slug: "hotel-demo",
  status: "active",
  allowedToolIds: [],
};

const actor = { id: "visitor", type: "customer", roles: ["customer"], permissions: [] };

test("orchestrator routes greeting through the dialogue responder", async () => {
  const model = {
    async route() {
      return { kind: "message", purpose: "greeting", message: "¡Hola! Claro, decime en qué te puedo ayudar." };
    },
  };
  const responder = {
    calls: [],
    async compose(input) {
      this.calls.push(input);
      return "¡Hola! Buenas, ¿cómo te puedo ayudar?";
    },
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], model, responder });
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor, channel: "webchat" });
  const result = await runtime.orchestrator.chat("Hola", context);
  assert.equal(result.message, "¡Hola! Buenas, ¿cómo te puedo ayudar?");
  assert.equal(responder.calls.length, 1);
  assert.equal(responder.calls[0].kind, "message");
  assert.equal(responder.calls[0].purpose, "greeting");
});

test("server-side missing-field clarification is also composed through the bounded dialogue layer", async () => {
  const tool = {
    id: "demo.required",
    primitive: "CHECK",
    description: "demo",
    risk: "read",
    sideEffect: "none",
    requiredPermissions: [],
    inputSchema: { type: "object", properties: { guests: { type: "integer" } }, required: ["guests"] },
    validateInput(input) { return { ok: true, value: input }; },
    async execute() { return {}; },
  };
  const runtimeTenant = { ...tenant, allowedToolIds: [tool.id] };
  const model = { async route() { return { kind: "tool", plan: { toolId: tool.id, input: {} } }; } };
  const responder = {
    calls: [],
    async compose(input) {
      this.calls.push(input);
      return input.kind === "message" ? "Perfecto. ¿Para cuántas personas sería?" : "ok";
    },
  };
  const runtime = new AgentCoreRuntime({ tenants: [runtimeTenant], tools: [tool], model, responder });
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor, channel: "webchat" });
  const result = await runtime.orchestrator.chat("Quiero consultar", context);
  assert.equal(result.message, "Perfecto. ¿Para cuántas personas sería?");
  assert.equal(responder.calls[0].purpose, "clarification");
  assert.deepEqual(responder.calls[0].missing, ["guests"]);
});