import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";

const roomId2 = "11000000-0000-0000-0000-000000000002";
const roomId101 = "11000000-0000-0000-0000-000000000101";
const roomId102 = "11000000-0000-0000-0000-000000000102";

const reservationTool = {
  id: "hms.createReservation",
  primitive: "RESERVE",
  description: "reserve one grounded room",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: { roomId: { type: "string" }, checkIn: { type: "string" }, checkOut: { type: "string" } },
    required: ["roomId", "checkIn", "checkOut"],
  },
};
const multiReservationTool = { id: "hms.createMultiReservation", primitive: "RESERVE", description: "reserve multiple grounded rooms", risk: "write" };
const tools = [reservationTool, multiReservationTool];

function state(rooms) {
  return {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 3 },
    availabilityRoomIds: rooms.map((room) => room.id),
    availabilityRooms: rooms,
    selectedRoomIds: [],
  };
}

test("R2.8.4 final follow-up P2: declared room count must match enumerated room selection", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "Quiero reservar las 3 habitaciones 101 y 102.",
    {},
    tools,
    [],
    state([{ id: roomId101, roomNumber: "101" }, { id: roomId102, roomNumber: "102" }]),
  );
  assert.equal(result.kind, "message");
  assert.equal(result.purpose, "clarification");
  assert.ok(result.missing?.includes("selection"));
});

test("R2.8.4 final follow-up P2: natural-language time is not parsed as a room", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "Quiero reservar la 101 a las 2 de la tarde.",
    {},
    tools,
    [],
    state([{ id: roomId2, roomNumber: "2" }, { id: roomId101, roomNumber: "101" }]),
  );
  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createReservation");
  assert.equal(result.plan.input.roomId, roomId101);
  assert.deepEqual(result.statePatch?.selectedRoomIds, [roomId101]);
});

test("R2.8.4 final follow-up P2: instead-of correction excludes the replaced room", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "Quiero reservar la 101 en vez de la 102.",
    {},
    tools,
    [],
    state([{ id: roomId101, roomNumber: "101" }, { id: roomId102, roomNumber: "102" }]),
  );
  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createReservation");
  assert.equal(result.plan.input.roomId, roomId101);
  assert.deepEqual(result.statePatch?.selectedRoomIds, [roomId101]);
});
