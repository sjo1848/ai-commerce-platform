import test from "node:test";
import assert from "node:assert/strict";
import { dependencyFingerprint } from "../dist/cognitive/fingerprint.js";
import { conversationStateToTaskStateSeed } from "../dist/cognitive/conversation-state-adapter.js";

function baseState() {
  return {
    stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    semanticMemory: {
      revision: 4,
      stay: {
        checkIn: { source: "user", revision: 2 },
        checkOut: { source: "user", revision: 2 },
        guests: { source: "user", revision: 3 },
      },
      preferences: [{ value: "piso alto", source: "user", revision: 4 }],
      activeIntent: { value: "reservation", source: "user", revision: 4 },
    },
    availabilityRoomIds: ["room-101", "room-102"],
    availabilityRooms: [
      { id: "room-101", roomNumber: "101", roomType: "double", capacity: 2 },
      { id: "room-102", roomNumber: "102", roomType: "double", capacity: 2 },
    ],
    selectedRoomId: "room-102",
    selectedRoomIds: ["room-102"],
    requestedRoomCount: 1,
    roomOccupancy: [],
    roomSelectionRevision: 2,
  };
}

test("dependency fingerprints are stable across object key order", () => {
  assert.equal(
    dependencyFingerprint({ b: 2, a: { y: 2, x: 1 } }),
    dependencyFingerprint({ a: { x: 1, y: 2 }, b: 2 }),
  );
  assert.notEqual(
    dependencyFingerprint({ a: 1 }),
    dependencyFingerprint({ a: 2 }),
  );
});

test("legacy ConversationState seeds ACP-3.0 without turning goal into commit", () => {
  const task = conversationStateToTaskStateSeed(baseState(), { taskId: "task-1" });

  assert.equal(task.schemaVersion, "acp-task-state-v1");
  assert.equal(task.taskId, "task-1");
  assert.equal(task.lifecycle, "active");
  assert.equal(task.stateRevision, 4);
  assert.equal(task.user.requestedGoal, "reservation");
  assert.equal(task.user.operationIntent, undefined);
  assert.deepEqual(task.user.stay, { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });
  assert.deepEqual(task.user.preferences, ["piso alto"]);

  assert.equal(task.observations.availability?.source, "legacy_migration");
  assert.deepEqual(task.observations.availability?.query, {
    checkIn: "2027-01-15",
    checkOut: "2027-01-17",
    guests: 2,
  });
  assert.deepEqual(task.control.groundedSelection?.roomIds, ["room-102"]);
  assert.equal(task.control.groundedSelection?.authority, "legacy_migration");
});

test("incomplete legacy availability is not promoted as an authoritative observation", () => {
  const state = baseState();
  delete state.stay.guests;
  state.selectedRoomIds = ["room-102"];
  state.selectedRoomId = "room-102";

  const task = conversationStateToTaskStateSeed(state, { taskId: "task-2" });
  assert.equal(task.observations.availability, undefined);
  assert.equal(task.control.groundedSelection, undefined);
});

test("legacy booking identity stays in observation namespace and never creates cancel intent", () => {
  const state = {
    ...baseState(),
    activeBookingId: "BK-123",
    bookingStatus: "CONFIRMED",
    bookingStateRevision: 7,
  };
  const task = conversationStateToTaskStateSeed(state, { taskId: "task-3" });

  assert.equal(task.stateRevision, 7);
  assert.equal(task.observations.booking?.bookingId, "BK-123");
  assert.equal(task.observations.booking?.source, "legacy_migration");
  assert.equal(task.user.operationIntent, undefined);
  assert.equal(task.user.bookingReference, undefined);
});
