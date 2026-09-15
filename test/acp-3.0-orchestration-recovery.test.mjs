import test from "node:test";
import assert from "node:assert/strict";
import {
  createOrchestrationCycleRecord,
  runHotelPlanningCycle,
} from "../dist/cognitive/orchestration-cycle.js";
import { resolveHotelReferences } from "../dist/cognitive/reference-resolver.js";
import { reduceTaskState } from "../dist/cognitive/task-state-reducer.js";
import { hotelDomainCapabilities } from "../dist/cognitive/hotel-task-definition.js";

const NOW = "2026-09-15T22:15:00.000Z";
const capabilities = hotelDomainCapabilities();

function baseState() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-recovery",
    taskId: "task-recovery",
    lifecycle: "active",
    stateRevision: 1,
    recentEventIds: [],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      preferences: [],
    },
    observations: {
      availability: {
        observationId: "availability-recovery",
        status: "observed",
        source: "tool",
        query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
        rooms: [
          { roomId: "room-a", roomNumber: "101", capacity: 2 },
          { roomId: "room-b", roomNumber: "102", capacity: 2 },
        ],
        dependencyFingerprint: "availability:recovery",
        dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      },
      executionResults: [],
      failures: [],
    },
    control: {
      dialogueAnchor: {
        anchorId: "anchor-recovery",
        kind: "selection",
        createdAtStateRevision: 1,
        dependencyFingerprint: "anchor:recovery",
        dependencyPaths: ["observations.availability"],
        referencedObservationId: "availability-recovery",
        candidateScope: ["room-a", "room-b"],
      },
    },
    provenance: {},
  };
}

function primaryEvent() {
  return {
    eventId: "user-recovery-1",
    kind: "user_semantic",
    sessionId: "session-recovery",
    taskId: "task-recovery",
    expectedStateRevision: 1,
    occurredAt: NOW,
    payload: {
      requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 2 } },
    },
  };
}

function primaryTrigger() {
  return { origin: "user", acceptedEventId: "user-recovery-1" };
}

function reducedCycle(trigger) {
  return {
    ...createOrchestrationCycleRecord({ cycleId: "cycle-recovery", trigger, createdAt: NOW }),
    status: "reduced",
    updatedAt: NOW,
  };
}

test("crash after primary reducer resumes from reduced cycle without applying primary semantics again", async () => {
  const event = primaryEvent();
  const trigger = primaryTrigger();
  const reduced = reduceTaskState(baseState(), event);
  assert.equal(reduced.accepted, true);
  assert.equal(reduced.state.stateRevision, 2);

  const result = await runHotelPlanningCycle({
    state: reduced.state,
    primaryEvent: event,
    trigger,
    cycle: reducedCycle(trigger),
    capabilities,
    now: NOW,
  });

  assert.equal(result.kind, "planned");
  assert.equal(result.primaryReduction.duplicate, true);
  assert.equal(result.primaryReduction.material, false);
  assert.equal(result.state.recentEventIds.filter((id) => id === event.eventId).length, 1);
  assert.equal(result.state.stateRevision, 3);
  assert.deepEqual(result.state.control.groundedSelection.roomIds, ["room-b"]);
});

test("reduced cycle without persisted primary event fails closed", async () => {
  const event = primaryEvent();
  const trigger = primaryTrigger();
  const result = await runHotelPlanningCycle({
    state: baseState(),
    primaryEvent: event,
    trigger,
    cycle: reducedCycle(trigger),
    capabilities,
    now: NOW,
  });
  assert.equal(result.kind, "rejected");
  assert.equal(result.reason, "reduced_cycle_state_mismatch");
  assert.equal(result.state.stateRevision, 1);
});

test("crash after grounding reuses grounded state and does not create a second grounding event", async () => {
  const event = primaryEvent();
  const trigger = primaryTrigger();
  const primary = reduceTaskState(baseState(), event);
  assert.equal(primary.accepted, true);
  const resolution = await resolveHotelReferences(primary.state);
  assert.equal(resolution.instructions.length, 1);

  const grounding = {
    eventId: "cycle-recovery:ground:room",
    kind: "server_control",
    sessionId: primary.state.sessionId,
    taskId: primary.state.taskId,
    expectedStateRevision: primary.state.stateRevision,
    occurredAt: NOW,
    causationId: event.eventId,
    payload: resolution.instructions[0],
  };
  const grounded = reduceTaskState(primary.state, grounding);
  assert.equal(grounded.accepted, true);
  assert.equal(grounded.state.stateRevision, 3);

  const result = await runHotelPlanningCycle({
    state: grounded.state,
    primaryEvent: event,
    trigger,
    cycle: reducedCycle(trigger),
    capabilities,
    now: NOW,
  });
  assert.equal(result.kind, "planned");
  assert.equal(result.internalGroundingEvents.length, 0);
  assert.equal(result.state.stateRevision, 3);
  assert.equal(result.state.recentEventIds.filter((id) => id === grounding.eventId).length, 1);
  assert.equal(result.groundingDiagnostics.find((entry) => entry.target === "room").status, "already_grounded");
});

test("accepted cycle can recover when reducer committed but cycle status update was lost", async () => {
  const event = primaryEvent();
  const trigger = primaryTrigger();
  const primary = reduceTaskState(baseState(), event);
  assert.equal(primary.accepted, true);
  const acceptedCycle = createOrchestrationCycleRecord({ cycleId: "cycle-recovery", trigger, createdAt: NOW });

  const result = await runHotelPlanningCycle({
    state: primary.state,
    primaryEvent: event,
    trigger,
    cycle: acceptedCycle,
    capabilities,
    now: NOW,
  });
  assert.equal(result.kind, "planned");
  assert.equal(result.primaryReduction.duplicate, true);
  assert.equal(result.state.recentEventIds.filter((id) => id === event.eventId).length, 1);
});

test("server PLANNING_TRIGGER is reduced exactly once before Planner", async () => {
  const initial = baseState();
  initial.user.requestedSelectionReference = { kind: "room_number", value: "102" };
  const resolution = await resolveHotelReferences(initial);
  const grounding = {
    eventId: "ground-prepared",
    kind: "server_control",
    sessionId: initial.sessionId,
    taskId: initial.taskId,
    expectedStateRevision: initial.stateRevision,
    occurredAt: NOW,
    payload: resolution.instructions[0],
  };
  const grounded = reduceTaskState(initial, grounding);
  assert.equal(grounded.accepted, true);
  grounded.state.user.operationIntent = "reserve";
  grounded.state.control.preparedOperation = {
    operationId: "op-recovery",
    operationType: "reserve",
    operationFingerprint: "opfp-recovery",
    inputSnapshot: { roomId: "room-b" },
    status: "prepared",
    dependencyFingerprint: "prepared-dep",
    dependencyPaths: ["lifecycle", "control.groundedSelection", "user.operationIntent"],
  };

  const event = {
    eventId: "approval-required-recovery",
    kind: "server_control",
    sessionId: grounded.state.sessionId,
    taskId: grounded.state.taskId,
    expectedStateRevision: grounded.state.stateRevision,
    occurredAt: NOW,
    payload: {
      kind: "prepared_operation_status_changed",
      operationId: "op-recovery",
      operationFingerprint: "opfp-recovery",
      status: "approval_required",
    },
  };
  const trigger = { origin: "server", acceptedEventId: event.eventId };
  const cycle = createOrchestrationCycleRecord({ cycleId: "cycle-approval-required", trigger, createdAt: NOW });
  const before = grounded.state.stateRevision;

  const result = await runHotelPlanningCycle({ state: grounded.state, primaryEvent: event, trigger, cycle, capabilities, now: NOW });
  assert.equal(result.kind, "planned");
  assert.equal(result.primaryReduction.duplicate, false);
  assert.equal(result.state.stateRevision, before + 1);
  assert.equal(result.state.recentEventIds.filter((id) => id === event.eventId).length, 1);
  assert.equal(result.state.control.preparedOperation.status, "approval_required");
  assert.equal(result.nextStep.kind, "WAIT");
  assert.equal(result.nextStep.reason, "approval_pending");
});
