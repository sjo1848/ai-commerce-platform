import test from "node:test";
import assert from "node:assert/strict";
import { createOrchestrationCycleRecord, runHotelPlanningCycle } from "../dist/cognitive/orchestration-cycle.js";
import { hotelDomainCapabilities } from "../dist/cognitive/hotel-task-definition.js";

const NOW = "2026-09-15T22:25:00.000Z";
const capabilities = hotelDomainCapabilities();

function planned(result) {
  assert.equal(result.kind, "planned", result.kind === "rejected" ? `orchestration rejection: ${result.reason}` : undefined);
}

function toolPendingState() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-tool-cycle",
    taskId: "task-tool-cycle",
    lifecycle: "active",
    stateRevision: 3,
    recentEventIds: ["u-dates", "u-room", "s-invocation"],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      preferences: [],
      requestedSelectionReference: { kind: "room_number", value: "102" },
    },
    observations: { executionResults: [], failures: [] },
    control: {
      pendingToolInvocation: {
        invocationId: "inv-availability-tool-cycle",
        capabilityId: "hms.checkAvailability",
        status: "admitted",
        inputSnapshot: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
        admittedAt: "2026-09-15T22:24:00.000Z",
        leaseExpiresAt: "2026-09-15T22:30:00.000Z",
        dependencyFingerprint: "availability-tool-cycle-fp",
        dependencyPaths: ["lifecycle", "user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      },
    },
    provenance: {},
  };
}

test("tool observation is the primary cause; fresh availability can ground a previously requested room before one Planner call", async () => {
  const initial = toolPendingState();
  const event = {
    eventId: "tool-availability-result",
    kind: "tool_observation",
    sessionId: initial.sessionId,
    taskId: initial.taskId,
    expectedStateRevision: initial.stateRevision,
    occurredAt: NOW,
    payload: {
      kind: "availability",
      authority: {
        kind: "invocation",
        invocationId: "inv-availability-tool-cycle",
        dependencyFingerprint: "availability-tool-cycle-fp",
      },
      observation: {
        observationId: "availability-tool-cycle",
        status: "observed",
        source: "tool",
        query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
        rooms: [
          { roomId: "room-101", roomNumber: "101", capacity: 2 },
          { roomId: "room-102", roomNumber: "102", capacity: 2 },
        ],
        dependencyFingerprint: "availability-tool-cycle-fp",
        dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      },
    },
  };
  const trigger = { origin: "tool", acceptedEventId: event.eventId, correlationId: "inv-availability-tool-cycle" };
  const result = await runHotelPlanningCycle({
    state: initial,
    primaryEvent: event,
    trigger,
    cycle: createOrchestrationCycleRecord({ cycleId: "cycle-tool-result", trigger, createdAt: NOW }),
    capabilities,
    now: NOW,
  });

  planned(result);
  assert.equal(result.primaryReduction.state.observations.availability.observationId, "availability-tool-cycle");
  assert.equal(result.primaryReduction.state.control.groundedSelection, undefined);
  assert.equal(result.internalGroundingEvents.length, 1);
  assert.deepEqual(result.state.control.groundedSelection.roomIds, ["room-102"]);
  assert.equal(result.planningTrigger.origin, "tool");
  assert.equal(result.planningTrigger.acceptedEventId, event.eventId);
  assert.equal(result.planningTrigger.observationKind, "availability");
  assert.equal(result.nextStep.kind, "RESPOND");
  assert.equal(result.nextStep.responseIntent, "reservation_ready_for_commit");
});

function staleAvailabilityState() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-correction",
    taskId: "task-correction",
    lifecycle: "active",
    stateRevision: 5,
    recentEventIds: [],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      preferences: [],
      requestedSelectionReference: { kind: "ordinal", value: 2 },
    },
    observations: {
      availability: {
        observationId: "availability-stale",
        status: "observed",
        source: "tool",
        query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
        rooms: [
          { roomId: "room-old-1", roomNumber: "101", capacity: 2 },
          { roomId: "room-old-2", roomNumber: "102", capacity: 2 },
        ],
        dependencyFingerprint: "availability-stale-fp",
        dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      },
      executionResults: [],
      failures: [],
    },
    control: {
      groundedSelection: {
        roomIds: ["room-old-2"],
        sourceObservationId: "availability-stale",
        authority: "server",
        dependencyFingerprint: "selection-stale-fp",
        dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
      },
      dialogueAnchor: {
        anchorId: "anchor-stale",
        kind: "selection",
        createdAtStateRevision: 5,
        dependencyFingerprint: "anchor-stale-fp",
        dependencyPaths: ["observations.availability"],
        referencedObservationId: "availability-stale",
        candidateScope: ["room-old-1", "room-old-2"],
        selectedCandidates: ["room-old-2"],
      },
    },
    provenance: {},
  };
}

test("date correction wins before grounding: stale availability/anchor are invalidated and cannot be reused", async () => {
  const initial = staleAvailabilityState();
  const event = {
    eventId: "user-date-correction",
    kind: "user_semantic",
    sessionId: initial.sessionId,
    taskId: initial.taskId,
    expectedStateRevision: initial.stateRevision,
    occurredAt: NOW,
    payload: {
      stay: { checkOut: { op: "set", value: "2027-01-18" } },
      requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 2 } },
    },
  };
  const trigger = { origin: "user", acceptedEventId: event.eventId };
  const result = await runHotelPlanningCycle({
    state: initial,
    primaryEvent: event,
    trigger,
    cycle: createOrchestrationCycleRecord({ cycleId: "cycle-date-correction", trigger, createdAt: NOW }),
    capabilities,
    now: NOW,
  });

  planned(result);
  assert.equal(result.primaryReduction.state.observations.availability, undefined);
  assert.equal(result.primaryReduction.state.control.groundedSelection, undefined);
  assert.equal(result.internalGroundingEvents.length, 0);
  assert.equal(result.state.control.groundedSelection, undefined);
  assert.equal(result.nextStep.kind, "CALL_TOOL");
  assert.equal(result.nextStep.capabilityId, "hms.checkAvailability");
  assert.equal(result.nextStep.groundedInput.checkOut, "2027-01-18");
});

test("abort + read directives are both preserved through normalization; read remains lateral and abort does not become a hidden workflow", async () => {
  const initial = staleAvailabilityState();
  initial.user.operationIntent = "reserve";
  const event = {
    eventId: "user-abort-read",
    kind: "user_semantic",
    sessionId: initial.sessionId,
    taskId: initial.taskId,
    expectedStateRevision: initial.stateRevision,
    occurredAt: NOW,
    payload: { operationIntent: { op: "clear" } },
  };
  const trigger = {
    origin: "user",
    acceptedEventId: event.eventId,
    abortDirective: true,
    readDirective: { kind: "quote", target: "current_selection" },
  };
  const result = await runHotelPlanningCycle({
    state: initial,
    primaryEvent: event,
    trigger,
    cycle: createOrchestrationCycleRecord({ cycleId: "cycle-abort-read", trigger, createdAt: NOW }),
    capabilities,
    now: NOW,
  });
  planned(result);
  assert.equal(result.state.user.operationIntent, undefined);
  assert.equal(result.planningTrigger.abortDirective, true);
  assert.deepEqual(result.planningTrigger.readDirective, { kind: "quote", target: "current_selection" });
  assert.equal(result.nextStep.kind, "CALL_TOOL");
  assert.equal(result.nextStep.capabilityId, "hms.getQuote");
});
