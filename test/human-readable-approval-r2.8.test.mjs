import assert from "node:assert/strict";
import test from "node:test";
import { emptyConversationState } from "../dist/core/conversation-state.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { InMemoryApprovalStore } from "../dist/webchat/approval.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";

const room101 = "11000000-0000-0000-0000-000000000001";
const room102 = "11000000-0000-0000-0000-000000000002";
const now = () => new Date("2026-09-02T03:15:00.000Z");

const tenant = {
  id: "hotel-demo",
  slug: "hotel-demo",
  status: "active",
  allowedToolIds: ["hms.createMultiReservation"],
  toolPolicies: { "hms.createMultiReservation": "approval" },
};

const actor = {
  id: "visitor-demo",
  type: "customer",
  roles: ["customer"],
  permissions: ["hms.reservation.write"],
};

const tool = {
  id: "hms.createMultiReservation",
  primitive: "RESERVE",
  description: "Create a grounded multi-room reservation",
  risk: "write",
  sideEffect: "reversible",
  requiredPermissions: ["hms.reservation.write"],
  inputSchema: {
    type: "object",
    required: ["roomIds", "checkIn", "checkOut"],
    properties: {
      roomIds: { type: "array", items: { type: "string" } },
      checkIn: { type: "string" },
      checkOut: { type: "string" },
    },
  },
  validateInput(input) {
    return { ok: true, value: structuredClone(input) };
  },
  async execute() {
    throw new Error("must not execute before approval");
  },
};

function post(handler, body, key) {
  return handler(new Request("https://agent.example/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  }));
}

test("R2.8.5 approval challenge names rooms 101/102 without exposing canonical UUIDs", async () => {
  const model = {
    async route() {
      return { kind: "tool", plan: { toolId: "hms.createMultiReservation", input: {} } };
    },
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools: [tool], model, now });
  const approvalStore = new InMemoryApprovalStore(now);
  const handler = createWebchatHandler(runtime, {
    fixedTenantId: "hotel-demo",
    fixedActorId: "visitor-demo",
    approvalStore,
  });
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor, channel: "webchat", requestId: "r2.8.5-seed" });
  const state = emptyConversationState();
  state.stay = { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 4 };
  state.availabilityRoomIds = [room101, room102];
  state.availabilityRooms = [
    { id: room101, roomNumber: "101", roomType: "DOUBLE" },
    { id: room102, roomNumber: "102", roomType: "DOUBLE" },
  ];
  state.selectedRoomIds = [room101, room102];
  state.requestedRoomCount = 2;
  state.roomOccupancy = { [room101]: 2, [room102]: 2 };
  state.roomSelectionRevision = 1;
  await runtime.conversationState.put(context.session.id, state);

  const response = await post(handler, { message: "reservá esas dos", sessionId: context.session.id }, "r2.8.5-create-1");
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "APPROVAL_REQUIRED");
  assert.match(body.approvalSummary, /habitaciones?\s+101\s+y\s+102|101[^0-9]+102/i);
  assert.match(body.approvalSummary, /2030-01-01/);
  assert.match(body.approvalSummary, /2030-01-03/);
  assert.doesNotMatch(body.approvalSummary, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});
