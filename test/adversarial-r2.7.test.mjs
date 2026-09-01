import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";
import { LLMModelRouter } from "../dist/core/llm-model.js";
import { applyUserSemanticTurn, emptyConversationState } from "../dist/core/conversation-state.js";

const roomA = "11000000-0000-0000-0000-000000000001";
const roomB = "11000000-0000-0000-0000-000000000002";

const createMulti = {
  id: "hms.createMultiReservation",
  primitive: "RESERVE",
  description: "create a grounded multi-room reservation",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {
      roomIds: { type: "array", items: { type: "string" } },
      checkIn: { type: "string" },
      checkOut: { type: "string" },
    },
    required: ["roomIds", "checkIn", "checkOut"],
  },
};

const createSingle = {
  id: "hms.createReservation",
  primitive: "RESERVE",
  description: "single-room reservation",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: { roomId: { type: "string" }, checkIn: { type: "string" }, checkOut: { type: "string" } },
    required: ["roomId", "checkIn", "checkOut"],
  },
};

const availability = {
  id: "hms.checkAvailability",
  primitive: "CHECK",
  description: "availability",
  risk: "read",
  inputSchema: {
    type: "object",
    properties: { checkIn: { type: "string" }, checkOut: { type: "string" }, guests: { type: "integer" } },
    required: ["checkIn", "checkOut", "guests"],
  },
};

function multiState() {
  return {
    ...emptyConversationState(),
    stay: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 4 },
    availabilityRoomIds: [roomA, roomB],
    availabilityRooms: [
      { id: roomA, roomNumber: "101", capacity: 2 },
      { id: roomB, roomNumber: "102", capacity: 2 },
    ],
    selectedRoomIds: [roomA, roomB],
    requestedRoomCount: 2,
  };
}

test("R2.7 provider failure preserves R2.5 multi-room orchestration instead of stale unsupported fallback", async () => {
  const fallback = new DeterministicModelRouter();
  const provider = { async completeStructured() { throw new Error("provider down"); } };
  const router = new LLMModelRouter(provider, fallback);
  const result = await router.route(
    "Perfecto, reservame las dos",
    { now: "2034-01-01T00:00:00.000Z" },
    [createSingle, createMulti],
    [],
    multiState(),
  );

  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createMultiReservation");
  assert.notEqual(result.plan.toolId, "hms.createReservation");
});

test("R2.7 fallback never collapses grounded multi-room intent into the single-room tool", async () => {
  const result = await new DeterministicModelRouter().route(
    "reservame las dos",
    {},
    [createSingle, createMulti],
    [],
    multiState(),
  );
  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createMultiReservation");
});

test("R2.7 natural 'habitaciones para dos' persists user-owned guest count", () => {
  const scope = { tenantId: "hotel-demo", actorId: "visitor-demo", sessionId: "session-r27" };
  const state = applyUserSemanticTurn(emptyConversationState(), "¿Tenés habitaciones para dos?", scope);
  assert.equal(state.stay.guests, 2);
  assert.equal(state.semanticMemory.stay.guests?.source, "user");
  assert.equal(state.semanticMemory.activeIntent?.value, "availability");
});

test("R2.7 numeric 'habitaciones para 2' is equivalent and fallback asks dates, not guests", async () => {
  const scope = { tenantId: "hotel-demo", actorId: "visitor-demo", sessionId: "session-r27-num" };
  const state = applyUserSemanticTurn(emptyConversationState(), "¿Tenés habitaciones para 2?", scope);
  assert.equal(state.stay.guests, 2);

  const result = await new DeterministicModelRouter().route(
    "¿Tenés habitaciones para 2?",
    {},
    [availability],
    [],
    state,
  );
  assert.equal(result.kind, "message");
  assert.deepEqual(result.missing, ["dates"]);
  assert.doesNotMatch(result.message, /cuántas personas/i);
});
