import test from "node:test";
import assert from "node:assert/strict";
import { projectConversationStateToTaskStateV1 } from "../dist/core/task-state-adapter.js";

const identity = {
  taskId: "task-1",
  sessionId: "session-1",
  tenantId: "tenant-1",
  actorId: "actor-1",
};

function state(overrides = {}) {
  return {
    stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    semanticMemory: {
      revision: 7,
      scope: { tenantId: identity.tenantId, actorId: identity.actorId, sessionId: identity.sessionId },
      stay: {
        checkIn: { source: "user", revision: 2 },
        checkOut: { source: "user", revision: 2 },
        guests: { source: "user", revision: 3 },
      },
      preferences: [{ value: "cama doble", source: "user", revision: 4 }],
      activeIntent: { value: "reservation", source: "user", revision: 1 },
    },
    availabilityRoomIds: ["room-101", "room-102"],
    availabilityRooms: [
      { id: "room-101", roomNumber: "101", roomType: "Doble", capacity: 2 },
      { id: "room-102", roomNumber: "102", roomType: "Superior", capacity: 2 },
    ],
    selectedRoomId: "room-102",
    selectedRoomIds: ["room-102"],
    requestedRoomCount: 1,
    roomOccupancy: [{ roomId: "room-102", guests: 2 }],
    roomSelectionRevision: 5,
    activeBookingId: "BK-123",
    bookingStatus: "confirmed",
    bookingStateRevision: 6,
    ...overrides,
  };
}

test("projects only durable user-owned semantics into ACP-3.0 TaskState", () => {
  const result = projectConversationStateToTaskStateV1(state(), identity);

  assert.equal(result.taskState.taskId, identity.taskId);
  assert.equal(result.taskState.lifecycle, "active");
  assert.equal(result.taskState.requestedGoal?.value, "reservation");
  assert.equal(result.taskState.requestedStay.checkIn?.value, "2027-01-15");
  assert.equal(result.taskState.requestedStay.checkOut?.value, "2027-01-17");
  assert.equal(result.taskState.requestedStay.guests?.value, 2);
  assert.equal(result.taskState.preferences[0]?.value, "cama doble");
  assert.deepEqual(result.taskState.recentEventIds, []);
});

test("does not silently promote legacy operational state without dependency receipts", () => {
  const result = projectConversationStateToTaskStateV1(state(), identity);

  assert.deepEqual(result.taskState.availability, { status: "not_queried", rooms: [], dependencyKeys: [] });
  assert.deepEqual(result.taskState.groundedSelection, { status: "none", roomIds: [], dependencyKeys: [] });
  assert.deepEqual(result.taskState.quote, { status: "not_queried", roomIds: [], dependencyKeys: [] });
  assert.deepEqual(result.taskState.bookings, []);
  assert.deepEqual(result.taskState.execution, { status: "not_started" });
  assert.equal(result.taskState.requestedRoomCount, undefined);

  assert.deepEqual(result.legacyOperationalCandidates.selectedRoomIds, ["room-102"]);
  assert.equal(result.legacyOperationalCandidates.activeBookingId, "BK-123");
  assert.equal(result.legacyOperationalCandidates.availabilityRooms[1]?.roomNumber, "102");
});

test("tool/server-derived stay values are not reclassified as user requests", () => {
  const source = state({
    semanticMemory: {
      ...state().semanticMemory,
      stay: {
        checkIn: { source: "tool", revision: 8 },
        checkOut: { source: "server", revision: 8 },
        guests: { source: "user", revision: 9 },
      },
    },
  });
  const result = projectConversationStateToTaskStateV1(source, identity);

  assert.equal(result.taskState.requestedStay.checkIn, undefined);
  assert.equal(result.taskState.requestedStay.checkOut, undefined);
  assert.equal(result.taskState.requestedStay.guests?.value, 2);
});

test("fails closed when semantic-memory scope does not match trusted identity", () => {
  const source = state({
    semanticMemory: {
      ...state().semanticMemory,
      scope: { tenantId: "other-tenant", actorId: identity.actorId, sessionId: identity.sessionId },
    },
  });

  assert.throws(
    () => projectConversationStateToTaskStateV1(source, identity),
    /Conversation semantic memory scope mismatch/,
  );
});
