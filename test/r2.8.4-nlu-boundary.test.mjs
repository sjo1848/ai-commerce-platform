import test from "node:test";
import assert from "node:assert/strict";
import { LLMModelRouter } from "../dist/core/llm-model.js";
import { applyConversationStatePatch, emptyConversationState, multiRoomConversationIssue } from "../dist/core/conversation-state.js";

const context = {
  requestId: "r28-boundary",
  tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: ["hms.checkAvailability", "hms.createMultiReservation"] },
  actor: { id: "visitor", type: "customer", roles: ["customer"], permissions: [] },
  session: { id: "s28-boundary", tenantId: "hotel-demo", actorId: "visitor", channel: "webchat", createdAt: "2030-01-01T00:00:00.000Z", expiresAt: "2030-01-02T00:00:00.000Z" },
  now: "2030-01-01T00:00:00.000Z",
};

const writeTool = { id: "hms.createMultiReservation", primitive: "RESERVE", description: "reserve", risk: "write", inputSchema: { type: "object", properties: {} } };
const readTool = { id: "hms.checkAvailability", primitive: "CHECK", description: "availability", risk: "read", inputSchema: { type: "object", properties: { checkIn: {}, checkOut: {}, guests: {} } } };

function routeResult(kind, toolId = "", input = {}, statePatch = {}, clarificationReason = "none", missing = []) {
  return { value: { kind, toolId, input, clarificationReason, missing, statePatch } };
}

test("R2.8.4 provider failure discards malicious write fallback plan and statePatch", async () => {
  const fallback = { async route() { return { kind: "tool", plan: { toolId: writeTool.id, input: {} }, statePatch: { selectedRoomNumbers: ["101", "102"] } }; } };
  const router = new LLMModelRouter({ async completeStructured() { throw new Error("provider down"); } }, fallback);
  const result = await router.route("reservá la 101 y la 102", context, [writeTool]);
  assert.equal(result.kind, "message");
  assert.equal(Object.hasOwn(result, "plan"), false);
  assert.equal(Object.hasOwn(result, "statePatch"), false);
});

test("R2.8.4 invalid route and repair failure use no-write fallback boundary", async () => {
  const fallback = { async route() { return { kind: "tool", plan: { toolId: writeTool.id, input: {} }, statePatch: { selectedRoomIds: ["room-a"] } }; } };
  const provider = { async completeStructured() { return routeResult("tool", writeTool.id, {}, { selectedRoomNumbers: ["101"] }, "missing", ["selection"]); } };
  const router = new LLMModelRouter(provider, fallback);
  const result = await router.route("reservá", context, [writeTool]);
  assert.equal(result.kind, "message");
  assert.equal(Object.hasOwn(result, "plan"), false);
  assert.equal(Object.hasOwn(result, "statePatch"), false);
});

test("R2.8.4 read-only fallback may answer but cannot carry semantic statePatch", async () => {
  const fallback = { async route() { return { kind: "message", purpose: "help", message: "Puedo consultar disponibilidad.", statePatch: { selectedRoomNumbers: ["101"] } }; } };
  const router = new LLMModelRouter({ async completeStructured() { throw new Error("provider down"); } }, fallback);
  const result = await router.route("¿qué hay disponible?", context, [readTool]);
  assert.equal(result.kind, "message");
  assert.equal(Object.hasOwn(result, "statePatch"), false);
});

test("R2.8.4 mixed room grounding fails all-or-nothing without partial replacement", () => {
  const current = { ...emptyConversationState(), availabilityRoomIds: ["room-a"], availabilityRooms: [{ id: "room-a", roomNumber: "101" }], selectedRoomIds: ["old-room"], requestedRoomCount: 1 };
  const next = applyConversationStatePatch(current, { selectedRoomNumbers: ["101", "999"], requestedRoomCount: 2 });
  assert.deepEqual(next.selectedRoomIds, []);
  assert.equal(next.requestedRoomCount, 2);
  assert.equal(multiRoomConversationIssue(next), "which_rooms");
});

test("R2.8.4 valid structured selection replaces stale selection and synchronizes requested count", () => {
  const current = { ...emptyConversationState(), availabilityRoomIds: ["room-a", "room-b"], availabilityRooms: [{ id: "room-a", roomNumber: "101" }, { id: "room-b", roomNumber: "102" }], selectedRoomIds: ["old-room"], requestedRoomCount: 1 };
  const next = applyConversationStatePatch(current, { selectedRoomIds: ["room-a", "room-b"], requestedRoomCount: 2 });
  assert.deepEqual(next.selectedRoomIds, ["room-a", "room-b"]);
  assert.equal(next.requestedRoomCount, 2);
});

test("R2.8.4 explicit room-count mismatch blocks structured write", () => {
  const current = { ...emptyConversationState(), availabilityRoomIds: ["room-a", "room-b"], availabilityRooms: [{ id: "room-a", roomNumber: "101" }, { id: "room-b", roomNumber: "102" }] };
  const next = applyConversationStatePatch(current, { selectedRoomIds: ["room-a", "room-b"], requestedRoomCount: 3 });
  assert.equal(multiRoomConversationIssue(next), "which_rooms");
});
