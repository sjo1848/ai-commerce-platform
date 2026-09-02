import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";

const roomId101 = "11000000-0000-0000-0000-000000000001";
const roomId102 = "11000000-0000-0000-0000-000000000002";

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

test("R2.8.4 fresh Codex P2: negated room reference is excluded from corrected final selection", async () => {
  const router = new DeterministicModelRouter();
  const state = {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 2 },
    availabilityRoomIds: [roomId101, roomId102],
    availabilityRooms: [
      { id: roomId101, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
    ],
    selectedRoomIds: [],
  };

  const result = await router.route(
    "No la 101; quiero reservar la 102.",
    {},
    [reservationTool, multiReservationTool],
    [],
    state,
  );

  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createReservation");
  assert.equal(result.plan.input.roomId, roomId102);
  assert.deepEqual(result.statePatch?.selectedRoomIds, [roomId102]);
});
