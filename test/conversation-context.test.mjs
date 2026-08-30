import test from "node:test";
import assert from "node:assert/strict";
import { AgentCoreRuntime } from "../dist/core/runtime.js";

const tenant = {
  id: "hotel-demo",
  slug: "hotel-demo",
  status: "active",
  allowedToolIds: ["hms.checkAvailability"],
  toolPolicies: { "hms.checkAvailability": "auto" },
};
const actor = {
  id: "visitor-demo",
  type: "customer",
  roles: ["customer"],
  permissions: ["hms.availability.read"],
};
const roomId = "11000000-0000-0000-0000-000000000001";

function availabilityTool() {
  return {
    id: "hms.checkAvailability",
    primitive: "CHECK",
    description: "availability",
    risk: "read",
    sideEffect: "none",
    requiredPermissions: ["hms.availability.read"],
    validateInput(input) { return { ok: true, value: input }; },
    async execute() {
      return { source: "hms", truth: "transactional", rooms: [{ id: roomId, roomNumber: "101", priceCents: 25000 }] };
    },
  };
}

test("second model turn receives prior user, tool and grounded assistant history owned by the server", async () => {
  const calls = [];
  const model = {
    async route(message, _context, _tools, conversation = []) {
      calls.push({ message, conversation: structuredClone(conversation) });
      if (calls.length === 1) {
        return { kind: "tool", plan: { toolId: "hms.checkAvailability", input: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 2 } } };
      }
      return { kind: "message", message: "La primera opción es la habitación 101." };
    },
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools: [availabilityTool()], model });
  const firstContext = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  const first = await runtime.orchestrator.chat("Somos dos, ¿qué hay?", firstContext);
  assert.equal(first.data.rooms[0].id, roomId);
  assert.match(first.message, /habitación 101/i);

  const secondContext = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat", sessionId: first.sessionId });
  await runtime.orchestrator.chat("¿Y la primera?", secondContext);
  assert.equal(calls.length, 2);
  const history = calls[1].conversation;
  assert.deepEqual(history.map((turn) => turn.role), ["user", "tool", "assistant"]);
  assert.equal(history[0].content, "Somos dos, ¿qué hay?");
  assert.equal(history[1].toolId, "hms.checkAvailability");
  assert.match(history[1].content, new RegExp(roomId));
  assert.match(history[2].content, /habitación 101/i);
});

test("conversation history is bounded and never supplied by request metadata", async () => {
  const histories = [];
  const model = {
    async route(_message, _context, _tools, conversation = []) {
      histories.push(structuredClone(conversation));
      return { kind: "message", message: "ok" };
    },
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools: [availabilityTool()], model });
  let sessionId;
  for (let i = 0; i < 10; i += 1) {
    const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat", ...(sessionId ? { sessionId } : {}) });
    sessionId = context.session.id;
    await runtime.orchestrator.chat(`mensaje ${i}`, context);
  }
  assert.ok(histories.at(-1).length <= 12);
  assert.ok(histories.at(-1).every((turn) => !Object.hasOwn(turn, "tenantId") && !Object.hasOwn(turn, "actorId")));
});
