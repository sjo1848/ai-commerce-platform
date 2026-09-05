import test from "node:test";
import assert from "node:assert/strict";
import { applyUserSemanticTurn, InMemoryConversationStateStore, updateConversationStateFromTool } from "../dist/core/conversation-state.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";

const tenant = {
  id: "hotel-memory-tool",
  slug: "hotel-memory-tool",
  status: "active",
  allowedToolIds: ["hms.checkAvailability"],
  toolPolicies: { "hms.checkAvailability": "auto" },
};
const actor = {
  id: "visitor-memory-tool",
  type: "customer",
  roles: ["customer"],
  permissions: ["hms.availability.read"],
};

function availabilityTool() {
  return {
    id: "hms.checkAvailability",
    primitive: "CHECK",
    description: "availability",
    risk: "read",
    sideEffect: "none",
    requiredPermissions: ["hms.availability.read"],
    inputSchema: {
      type: "object",
      properties: { checkIn: {}, checkOut: {}, guests: {} },
      required: ["checkIn", "checkOut", "guests"],
    },
    validateInput(input) {
      if (!input?.checkIn || !input?.checkOut || !Number.isInteger(input?.guests)) return { ok: false, message: "invalid" };
      return { ok: true, value: input };
    },
    async execute(input) {
      return {
        source: "hms",
        truth: "transactional",
        start: input.checkIn,
        end: input.checkOut,
        requestedGuests: input.guests,
        rooms: [{ id: "room-from-old-stay", roomNumber: "101", roomType: "DOUBLE", priceCents: 10000 }],
      };
    },
  };
}

test("an older approved/tool plan cannot roll back newer authoritative availability or ground old rooms", async () => {
  const stateStore = new InMemoryConversationStateStore();
  const runtime = new AgentCoreRuntime({
    tenants: [tenant],
    tools: [availabilityTool()],
    conversationStateStore: stateStore,
  });
  const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  const scope = { tenantId: tenant.id, actorId: actor.id, sessionId: context.session.id };
  const corrected = applyUserSemanticTurn(
    applyUserSemanticTurn(await stateStore.get(context.session.id), "Somos dos del 10 al 12 de enero de 2027", scope),
    "No, pará: somos tres del 15 al 17 de enero de 2027",
    scope,
  );
  await stateStore.put(context.session.id, updateConversationStateFromTool(
    corrected,
    "hms.checkAvailability",
    { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 3 },
    { rooms: [{ id: "room-current-stay", roomNumber: "101" }] },
  ));

  await runtime.orchestrator.executeApprovedPlan(
    { toolId: "hms.checkAvailability", input: { checkIn: "2027-01-10", checkOut: "2027-01-12", guests: 2 } },
    context,
    { humanApproved: true, approvedOperationFingerprint: "test-only-approved-plan" },
  );

  const stored = await stateStore.get(context.session.id);
  assert.deepEqual(stored.stay, { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 3 });
  assert.equal(stored.semanticMemory.stay.checkIn.source, "tool");
  assert.equal(stored.semanticMemory.stay.checkOut.source, "tool");
  assert.equal(stored.semanticMemory.stay.guests.source, "tool");
  assert.deepEqual(stored.availabilityRoomIds, []);
  assert.equal(stored.selectedRoomId, undefined);
});
