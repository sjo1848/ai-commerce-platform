import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";

const roomId2 = "11000000-0000-0000-0000-000000000002";
const roomId101 = "11000000-0000-0000-0000-000000000101";
const roomId102 = "11000000-0000-0000-0000-000000000102";
const roomId103 = "11000000-0000-0000-0000-000000000103";

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
const tools = [reservationTool, multiReservationTool];

function state(rooms) {
  return {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 3 },
    availabilityRoomIds: rooms.map((room) => room.id),
    availabilityRooms: rooms,
    selectedRoomIds: [],
  };
}

test("R2.8.4 latest Codex P2: ordinal room count is a quantity, never room number 2", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "Quiero reservar las 2 primeras habitaciones.",
    {},
    tools,
    [],
    state([
      { id: roomId2, roomNumber: "2" },
      { id: roomId101, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
    ]),
  );

  assert.equal(result.kind, "message");
  assert.equal(result.purpose, "clarification");
  assert.ok(result.missing?.includes("selection"));
});

test("R2.8.4 latest Codex P2: negated reservation clause excludes rejected room", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "No quiero reservar la 101; quiero reservar la 102.",
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
  assert.equal(result.plan.input.roomId, roomId102);
  assert.deepEqual(result.statePatch?.selectedRoomIds, [roomId102]);
});

test("R2.8.4 newest Codex P2: room range cannot silently route only its endpoints", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "Quiero reservar de la 101 a la 103.",
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

test("R2.8.4 newest Codex P2: bare stated room count must match enumerated selection", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "Quiero reservar 3 habitaciones, la 101 y la 102.",
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
