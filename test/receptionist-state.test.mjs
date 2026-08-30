import test from "node:test";
import assert from "node:assert/strict";
import { applyConversationStatePatch, enrichPlanInputFromState } from "../dist/core/conversation-state.js";

function state() {
  return {
    stay: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 5 },
    availabilityRoomIds: ["room-101-id", "room-102-id", "room-103-id"],
    availabilityRooms: [
      { id: "room-101-id", roomNumber: "101" },
      { id: "room-102-id", roomNumber: "102" },
      { id: "room-103-id", roomNumber: "103" },
    ],
    selectedRoomIds: [],
    roomGuestAllocations: {},
    activeBookingIds: [],
  };
}

test("room-number selection resolves plural user labels only through authoritative availability", () => {
  const next = applyConversationStatePatch(state(), { selectedRoomNumbers: ["102", "101"] });
  assert.deepEqual(next.selectedRoomIds, ["room-102-id", "room-101-id"]);
  assert.equal(next.selectedRoomId, "room-102-id");
  const plan = enrichPlanInputFromState("hms.createReservationBundle", {}, next);
  assert.deepEqual(plan, {
    roomIds: ["room-102-id", "room-101-id"],
    checkIn: "2034-02-10",
    checkOut: "2034-02-12",
  });
});

test("unknown room in a plural selection fails all-or-none instead of keeping a partial selection", () => {
  const prior = applyConversationStatePatch(state(), { selectedRoomNumbers: ["101", "102"] });
  const next = applyConversationStatePatch(prior, { selectedRoomNumbers: ["102", "999"] });
  assert.deepEqual(next.selectedRoomIds, []);
  assert.equal(next.selectedRoomId, undefined);
  assert.deepEqual(enrichPlanInputFromState("hms.createReservationBundle", {}, next), {
    checkIn: "2034-02-10",
    checkOut: "2034-02-12",
  });
});

test("declared party distribution persists by authoritative room id and derives total guests", () => {
  const initial = { ...state(), stay: { checkIn: "2034-02-10", checkOut: "2034-02-12" } };
  const next = applyConversationStatePatch(initial, {
    selectedRoomNumbers: ["101", "102"],
    roomGuestAllocations: [
      { roomNumber: "101", guests: 2 },
      { roomNumber: "102", guests: 3 },
    ],
  });
  assert.equal(next.stay.guests, 5);
  assert.deepEqual(next.roomGuestAllocations, { "room-101-id": 2, "room-102-id": 3 });
  assert.deepEqual(enrichPlanInputFromState("hms.createReservationBundle", {}, next), {
    roomIds: ["room-101-id", "room-102-id"],
    checkIn: "2034-02-10",
    checkOut: "2034-02-12",
    allocations: [
      { roomId: "room-101-id", guests: 2 },
      { roomId: "room-102-id", guests: 3 },
    ],
  });
});

test("allocation correction replaces prior distribution without losing stay dates", () => {
  const first = applyConversationStatePatch(state(), {
    selectedRoomNumbers: ["101", "102"],
    roomGuestAllocations: [
      { roomNumber: "101", guests: 2 },
      { roomNumber: "102", guests: 3 },
    ],
  });
  const corrected = applyConversationStatePatch(first, {
    guests: 5,
    roomGuestAllocations: [
      { roomNumber: "101", guests: 3 },
      { roomNumber: "102", guests: 2 },
    ],
  });
  assert.equal(corrected.stay.checkIn, "2034-02-10");
  assert.equal(corrected.stay.checkOut, "2034-02-12");
  assert.deepEqual(corrected.roomGuestAllocations, { "room-101-id": 3, "room-102-id": 2 });
});
