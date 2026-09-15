import test from "node:test";
import assert from "node:assert/strict";
import { planHotelTask } from "../dist/cognitive/hotel-task-planner.js";
import { hotelDomainCapabilities } from "../dist/cognitive/hotel-task-definition.js";

test("Planner fails closed if persisted availability query contradicts current requested stay", async () => {
  const state = {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-causal",
    taskId: "task-causal",
    lifecycle: "active",
    stateRevision: 9,
    recentEventIds: [],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-18", guests: 2 },
      preferences: [],
    },
    observations: {
      availability: {
        observationId: "availability-stale",
        status: "observed",
        source: "tool",
        query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
        rooms: [{ roomId: "room-101" }],
        dependencyFingerprint: "stale",
        dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      },
      executionResults: [],
      failures: [],
    },
    control: {},
    provenance: {},
  };
  const step = await planHotelTask({
    state,
    trigger: { origin: "user", acceptedEventId: "event-correction" },
    capabilities: hotelDomainCapabilities(),
  });
  assert.deepEqual(step, {
    kind: "DEGRADE",
    reasonCode: "availability_dependency_mismatch",
    recoverable: false,
    responseIntent: "state_invariant_violation",
  });
});
