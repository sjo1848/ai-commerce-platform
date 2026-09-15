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

test("dependency fingerprints use stable collision-resistant canonical SHA-256 identities", async () => {
  const left = await dependencyFingerprint({ b: 2, a: { y: 2, x: 1 } });
  const right = await dependencyFingerprint({ a: { x: 1, y: 2 }, b: 2 });
  assert.equal(left, right);
  assert.match(left, /^fp1:sha256:[0-9a-f]{64}$/);
  assert.notEqual(left, await dependencyFingerprint({ a: { x: 1, y: 3 }, b: 2 }));
  await assert.rejects(() => dependencyFingerprint({ value: Number.NaN }), TypeError);
});

test("legacy ConversationState seeds requested semantics but never operational truth or commit", () => {
  const seed = conversationStateToTaskStateSeed(baseState(), { taskId: "task-1" });
  const task = seed.taskState;

  assert.equal(task.schemaVersion, "acp-task-state-v1");
  assert.equal(task.taskId, "task-1");
  assert.equal(task.lifecycle, "active");
  assert.equal(task.stateRevision, 0);
  assert.equal(task.user.requestedGoal, "reservation");
  assert.equal(task.user.operationIntent, undefined);
  assert.deepEqual(task.user.stay, { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });
  assert.deepEqual(task.user.preferences, ["piso alto"]);
  assert.deepEqual(task.observations, { executionResults: [] });
  assert.deepEqual(task.control, {});

  assert.deepEqual(seed.legacyCompatibility.selectedRoomIds, ["room-102"]);
  assert.equal(seed.legacyCompatibility.availabilityRooms[1]?.roomNumber, "102");
  assert.equal(task.control.groundedSelection, undefined);
  assert.equal(task.observations.availability, undefined);
});

test("tool/server-provenanced legacy stay and intent do not enter user-requested TaskState semantics", () => {
  const state = baseState();
  state.semanticMemory.stay.checkIn = { source: "tool", revision: 5 };
  state.semanticMemory.stay.guests = { source: "server", revision: 6 };
  state.semanticMemory.activeIntent = { value: "reservation", source: "server", revision: 6 };

  const seed = conversationStateToTaskStateSeed(state, { taskId: "task-2" });
  assert.deepEqual(seed.taskState.user.stay, { checkOut: "2027-01-17" });
  assert.equal(seed.taskState.user.requestedGoal, undefined);
  assert.deepEqual(seed.legacyCompatibility.stay, {
    checkIn: "2027-01-15",
    checkOut: "2027-01-17",
    guests: 2,
  });
});

test("legacy room count, selection and booking remain compatibility-only until re-observed/re-grounded", () => {
  const state = {
    ...baseState(),
    activeBookingId: "BK-123",
    bookingStatus: "CONFIRMED",
    bookingStateRevision: 7,
  };
  const seed = conversationStateToTaskStateSeed(state, { taskId: "task-3" });

  assert.equal(seed.taskState.stateRevision, 0);
  assert.equal(seed.taskState.user.requestedRoomCount, undefined);
  assert.equal(seed.taskState.user.bookingReference, undefined);
  assert.equal(seed.taskState.user.operationIntent, undefined);
  assert.equal(seed.taskState.observations.booking, undefined);
  assert.equal(seed.taskState.control.groundedSelection, undefined);

  assert.equal(seed.legacyCompatibility.requestedRoomCount, 1);
  assert.deepEqual(seed.legacyCompatibility.selectedRoomIds, ["room-102"]);
  assert.equal(seed.legacyCompatibility.activeBookingId, "BK-123");
  assert.equal(seed.legacyCompatibility.bookingStatus, "CONFIRMED");
  assert.equal(seed.taskState.provenance.migratedFromConversationState?.bookingStateRevision, 7);
});
