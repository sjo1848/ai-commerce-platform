import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";

const roomId4 = "11000000-0000-0000-0000-000000000004";
const roomId101 = "11000000-0000-0000-0000-000000000001";
const roomId102 = "11000000-0000-0000-0000-000000000002";
const roomId103 = "11000000-0000-0000-0000-000000000003";

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

const multiReservationTool = {
  id: "hms.createMultiReservation",
  primitive: "RESERVE",
  description: "reserve multiple grounded rooms",
  risk: "write",
};

function state(rooms) {
  return {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 2 },
    availabilityRoomIds: rooms.map((room) => room.id),
    availabilityRooms: rooms,
    selectedRoomIds: [],
  };
}

const tools = [reservationTool, multiReservationTool];

test("R2.8.4 final Codex P2: worded residual continuation cannot route a strict room subset", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "Quiero reservar las habitaciones 101, 102 junto con 103.",
    {},
    tools,
    [],
    state([
      { id: roomId101, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
      { id: roomId103, roomNumber: "103" },
    ]),
  );

  assert.equal(result.kind, "message");
  assert.equal(result.purpose, "clarification");
  assert.ok(result.missing?.includes("selection"));
});

test("R2.8.4 final Codex P2: colon-formatted time is not parsed as another room", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "Quiero reservar la 101 para las 4:00.",
    {},
    tools,
    [],
    state([
      { id: roomId4, roomNumber: "4" },
      { id: roomId101, roomNumber: "101" },
    ]),
  );

  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createReservation");
  assert.equal(result.plan.input.roomId, roomId101);
  assert.deepEqual(result.statePatch?.selectedRoomIds, [roomId101]);
});

test("R2.8.4 final Codex P2: verbal negation excludes the following room mention", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "Quiero reservar la 101, pero no quiero la 102.",
    {},
    tools,
    [],
    state([
      { id: roomId101, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
    ]),
  );

  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createReservation");
  assert.equal(result.plan.input.roomId, roomId101);
  assert.deepEqual(result.statePatch?.selectedRoomIds, [roomId101]);
});
