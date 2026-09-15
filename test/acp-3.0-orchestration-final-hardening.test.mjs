import test from "node:test";
import assert from "node:assert/strict";
import { createOrchestrationCycleRecord, runHotelPlanningCycle } from "../dist/cognitive/orchestration-cycle.js";
import { reduceTaskState } from "../dist/cognitive/task-state-reducer.js";
import { resolveHotelReferences } from "../dist/cognitive/reference-resolver.js";
import { hotelDomainCapabilities } from "../dist/cognitive/hotel-task-definition.js";

const NOW = "2026-09-15T22:40:00.000Z";
const capabilities = hotelDomainCapabilities();

function state() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-final-i5",
    taskId: "task-final-i5",
    lifecycle: "active",
    stateRevision: 2,
    recentEventIds: [],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      preferences: [],
    },
    observations: {
      availability: {
        observationId: "availability-final",
        status: "observed",
        source: "tool",
        query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
        rooms: [
          { roomId: "room-final-101", roomNumber: "101", capacity: 2 },
          { roomId: "room-final-102", roomNumber: "102", capacity: 2 },
        ],
        dependencyFingerprint: "availability-final-fp",
        dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      },
      executionResults: [],
      failures: [],
    },
    control: {
      dialogueAnchor: {
        anchorId: "anchor-final",
        kind: "selection",
        createdAtStateRevision: 2,
        dependencyFingerprint: "anchor-final-fp",
        dependencyPaths: ["observations.availability"],
        referencedObservationId: "availability-final",
        candidateScope: ["room-final-101", "room-final-102"],
        focusedCandidate: "room-final-102",
        selectedCandidates: ["room-final-101"],
      },
    },
    provenance: {},
  };
}

function cycleFor(event, trigger = { origin: event.kind === "server_control" ? "server" : "user", acceptedEventId: event.eventId }) {
  return createOrchestrationCycleRecord({ cycleId: `cycle-${event.eventId}`, trigger, createdAt: NOW });
}

test("malformed published anchor focus/selection is rejected at the closed TaskState boundary and Resolver never consumes it", async () => {
  const malformedFocus = state();
  malformedFocus.control.dialogueAnchor.focusedCandidate = 42;
  const event = {
    eventId: "u-malformed-focus",
    kind: "user_semantic",
    sessionId: malformedFocus.sessionId,
    taskId: malformedFocus.taskId,
    expectedStateRevision: malformedFocus.stateRevision,
    occurredAt: NOW,
    payload: {},
  };
  assert.deepEqual(reduceTaskState(malformedFocus, event).rejection, "state_invariant_violation");

  const malformedSelection = state();
  malformedSelection.control.dialogueAnchor.selectedCandidates = "room-final-101";
  assert.deepEqual(reduceTaskState(malformedSelection, { ...event, eventId: "u-malformed-selection" }).rejection, "state_invariant_violation");

  malformedSelection.user.requestedSelectionReference = { kind: "contextual_anchor", role: "current_selection" };
  const resolution = await resolveHotelReferences(malformedSelection);
  assert.equal(resolution.instructions.length, 0);
});

test("STATE_ONLY control completes its cycle and replay cannot reopen Planner", async () => {
  const initial = state();
  const event = {
    eventId: "anchor-clear-final",
    kind: "server_control",
    sessionId: initial.sessionId,
    taskId: initial.taskId,
    expectedStateRevision: initial.stateRevision,
    occurredAt: NOW,
    payload: { kind: "dialogue_anchor_clear", anchorId: "anchor-final" },
  };
  const cycle = cycleFor(event);
  const first = await runHotelPlanningCycle({ state: initial, primaryEvent: event, cycle, capabilities, now: NOW });
  assert.equal(first.kind, "no_plan");
  assert.equal(first.disposition, "STATE_ONLY");
  assert.equal(first.cycle.status, "completed");

  const replay = await runHotelPlanningCycle({ state: first.state, primaryEvent: event, cycle: first.cycle, capabilities, now: NOW });
  assert.equal(replay.kind, "already_planned");
  assert.equal(replay.cycle.status, "completed");
});

test("TERMINAL_NO_PLAN lifecycle transition completes without Planner", async () => {
  const initial = state();
  const event = {
    eventId: "lifecycle-complete-final",
    kind: "server_control",
    sessionId: initial.sessionId,
    taskId: initial.taskId,
    expectedStateRevision: initial.stateRevision,
    occurredAt: NOW,
    payload: { kind: "lifecycle_changed", lifecycle: "completed" },
  };
  const result = await runHotelPlanningCycle({ state: initial, primaryEvent: event, cycle: cycleFor(event), capabilities, now: NOW });
  assert.equal(result.kind, "no_plan");
  assert.equal(result.disposition, "TERMINAL_NO_PLAN");
  assert.equal(result.state.lifecycle, "completed");
  assert.equal(result.cycle.status, "completed");
});

test("wrong session and stale revision are surfaced as primary reducer rejection before grounding or Planner", async () => {
  const initial = state();
  const wrongSession = {
    eventId: "wrong-session-final",
    kind: "user_semantic",
    sessionId: "other-session",
    taskId: initial.taskId,
    expectedStateRevision: initial.stateRevision,
    occurredAt: NOW,
    payload: {},
  };
  const wrongTrigger = { origin: "user", acceptedEventId: wrongSession.eventId };
  const wrong = await runHotelPlanningCycle({ state: initial, primaryEvent: wrongSession, trigger: wrongTrigger, cycle: cycleFor(wrongSession, wrongTrigger), capabilities, now: NOW });
  assert.equal(wrong.kind, "rejected");
  assert.equal(wrong.reason, "primary_reducer_rejected:wrong_session");

  const stale = {
    eventId: "stale-revision-final",
    kind: "user_semantic",
    sessionId: initial.sessionId,
    taskId: initial.taskId,
    expectedStateRevision: initial.stateRevision - 1,
    occurredAt: NOW,
    payload: {},
  };
  const staleTrigger = { origin: "user", acceptedEventId: stale.eventId };
  const staleResult = await runHotelPlanningCycle({ state: initial, primaryEvent: stale, trigger: staleTrigger, cycle: cycleFor(stale, staleTrigger), capabilities, now: NOW });
  assert.equal(staleResult.kind, "rejected");
  assert.equal(staleResult.reason, "primary_reducer_rejected:stale_state_revision");
});
