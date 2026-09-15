import test from "node:test";
import assert from "node:assert/strict";
import {
  createOrchestrationCycleRecord,
  runHotelPlanningCycle,
  serverControlDisposition,
} from "../dist/cognitive/orchestration-cycle.js";
import { resolveHotelReferences } from "../dist/cognitive/reference-resolver.js";
import { hotelDomainCapabilities } from "../dist/cognitive/hotel-task-definition.js";

const NOW = "2026-09-15T22:00:00.000Z";

function state() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-i5",
    taskId: "task-i5",
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
        observationId: "availability-1",
        status: "observed",
        source: "tool",
        query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
        rooms: [
          { roomId: "room-101", roomNumber: "101", capacity: 2 },
          { roomId: "room-102", roomNumber: "102", capacity: 2 },
        ],
        dependencyFingerprint: "availability:1",
        dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      },
      executionResults: [],
      failures: [],
    },
    control: {
      dialogueAnchor: {
        anchorId: "anchor-options-1",
        kind: "selection",
        createdAtStateRevision: 1,
        dependencyFingerprint: "anchor:1",
        dependencyPaths: ["observations.availability"],
        referencedObservationId: "availability-1",
        candidateScope: ["room-101", "room-102"],
      },
    },
    provenance: {},
  };
}

function userEvent(payload, id = "user-1") {
  return {
    eventId: id,
    kind: "user_semantic",
    sessionId: "session-i5",
    taskId: "task-i5",
    expectedStateRevision: 1,
    occurredAt: NOW,
    payload,
  };
}

function trigger(id = "user-1", overrides = {}) {
  return { origin: "user", acceptedEventId: id, ...overrides };
}

function cycleFor(value, id = "cycle-1") {
  return createOrchestrationCycleRecord({ cycleId: id, trigger: value, createdAt: NOW });
}

const capabilities = hotelDomainCapabilities();

test("ordinal selection is grounded only after primary reducer and enters state through INTERNAL_PREPLAN event", async () => {
  const event = userEvent({ requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 2 } } });
  const primaryTrigger = trigger();
  const result = await runHotelPlanningCycle({ state: state(), primaryEvent: event, trigger: primaryTrigger, cycle: cycleFor(primaryTrigger), capabilities, now: NOW });

  assert.equal(result.kind, "planned");
  assert.equal(result.primaryReduction.state.stateRevision, 2);
  assert.equal(result.internalGroundingEvents.length, 1);
  assert.equal(result.internalGroundingEvents[0].payload.kind, "reference_grounded");
  assert.equal(result.internalGroundingEvents[0].causationId, "user-1");
  assert.deepEqual(result.state.control.groundedSelection.roomIds, ["room-102"]);
  assert.equal(result.state.stateRevision, 3);
  assert.equal(result.planningTrigger.acceptedEventId, "user-1");
  assert.equal(result.planningTrigger.origin, "user");
  assert.deepEqual(result.nextStep, {
    kind: "RESPOND",
    responseIntent: "reservation_ready_for_commit",
    groundedReferences: ["availability-1"],
  });
});

test("stale published anchor cannot ground an ordinal and Planner asks for selection instead", async () => {
  const initial = state();
  initial.control.dialogueAnchor.referencedObservationId = "availability-old";
  const event = userEvent({ requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 2 } } });
  const primaryTrigger = trigger();
  const result = await runHotelPlanningCycle({ state: initial, primaryEvent: event, trigger: primaryTrigger, cycle: cycleFor(primaryTrigger), capabilities, now: NOW });

  assert.equal(result.kind, "planned");
  assert.equal(result.internalGroundingEvents.length, 0);
  assert.equal(result.groundingDiagnostics.find((entry) => entry.target === "room").status, "unresolved");
  assert.equal(result.state.control.groundedSelection, undefined);
  assert.equal(result.nextStep.kind, "ASK");
  assert.equal(result.nextStep.field, "selection");
});

test("read + commit survives internal grounding and Planner sees the original primary directive", async () => {
  const event = userEvent({
    requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 2 } },
    operationIntent: { op: "set", value: "reserve" },
  });
  const primaryTrigger = trigger("user-1", { readDirective: { kind: "quote", target: "current_selection" } });
  const result = await runHotelPlanningCycle({ state: state(), primaryEvent: event, trigger: primaryTrigger, cycle: cycleFor(primaryTrigger), capabilities, now: NOW });

  assert.equal(result.kind, "planned");
  assert.equal(result.internalGroundingEvents.length, 1);
  assert.deepEqual(result.planningTrigger.readDirective, { kind: "quote", target: "current_selection" });
  assert.equal(result.planningTrigger.acceptedEventId, "user-1");
  assert.equal(result.nextStep.kind, "CALL_TOOL");
  assert.equal(result.nextStep.capabilityId, "hms.getQuote");
  assert.equal(result.nextStep.effectClass, "read");
  assert.equal(result.state.user.operationIntent, "reserve");
});

test("room number resolves from current authoritative availability without presentation anchor", async () => {
  const initial = state();
  delete initial.control.dialogueAnchor;
  initial.user.requestedSelectionReference = { kind: "room_number", value: "101" };
  const result = await resolveHotelReferences(initial);
  assert.equal(result.instructions.length, 1);
  assert.equal(result.instructions[0].kind, "reference_grounded");
  assert.deepEqual(result.instructions[0].groundedSelection.roomIds, ["room-101"]);
  assert.deepEqual(result.instructions[0].groundedSelection.dependencyPaths, [
    "observations.availability",
    "user.requestedSelectionReference",
  ]);
});

test("ambiguous room number fails closed instead of choosing a candidate", async () => {
  const initial = state();
  initial.observations.availability.rooms.push({ roomId: "room-101-b", roomNumber: "101", capacity: 2 });
  initial.user.requestedSelectionReference = { kind: "room_number", value: "101" };
  const result = await resolveHotelReferences(initial);
  assert.equal(result.instructions.length, 0);
  assert.equal(result.diagnostics.find((entry) => entry.target === "room").status, "unresolved");
});

test("presented_set requires a current published scope and never reads arbitrary availability order", async () => {
  const initial = state();
  initial.user.requestedSelectionReference = { kind: "contextual_anchor", role: "presented_set" };
  let result = await resolveHotelReferences(initial);
  assert.deepEqual(result.instructions[0].groundedSelection.roomIds, ["room-101", "room-102"]);

  initial.control.dialogueAnchor.candidateScope = ["room-102", "unknown-room"];
  result = await resolveHotelReferences(initial);
  assert.equal(result.instructions.length, 0);
});

test("cycle identity mismatch fails before reducer or Planner", async () => {
  const event = userEvent({ requestedGoal: { op: "set", value: "reservation" } });
  const primaryTrigger = trigger();
  const badCycle = cycleFor({ ...primaryTrigger, acceptedEventId: "different-event" }, "cycle-mismatch");
  const result = await runHotelPlanningCycle({ state: state(), primaryEvent: event, trigger: primaryTrigger, cycle: badCycle, capabilities, now: NOW });
  assert.equal(result.kind, "rejected");
  assert.equal(result.reason, "cycle_primary_cause_mismatch");
  assert.equal(result.state.stateRevision, 1);
});

test("a planned cycle is not planned a second time on recovery", async () => {
  const event = userEvent({ requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 2 } } });
  const primaryTrigger = trigger();
  const first = await runHotelPlanningCycle({ state: state(), primaryEvent: event, trigger: primaryTrigger, cycle: cycleFor(primaryTrigger), capabilities, now: NOW });
  assert.equal(first.kind, "planned");

  const replay = await runHotelPlanningCycle({ state: first.state, primaryEvent: event, trigger: primaryTrigger, cycle: first.cycle, capabilities, now: NOW });
  assert.equal(replay.kind, "already_planned");
  assert.equal(replay.cycle.status, "planned");
});

test("server-control disposition is static and unknown controls fail closed", () => {
  assert.equal(serverControlDisposition({ kind: "reference_grounded", groundedSelection: {} }), "INTERNAL_PREPLAN");
  assert.equal(serverControlDisposition({ kind: "dialogue_anchor_clear" }), "STATE_ONLY");
  assert.equal(serverControlDisposition({ kind: "prepared_operation_status_changed", status: "approval_required" }), "PLANNING_TRIGGER");
  assert.equal(serverControlDisposition({ kind: "prepared_operation_status_changed", status: "approved" }), "RESUME_EXECUTION");
  assert.equal(serverControlDisposition({ kind: "lifecycle_changed", lifecycle: "completed" }), "TERMINAL_NO_PLAN");
  assert.equal(serverControlDisposition({ kind: "invented_control" }), undefined);
});

test("approved server control reduces state and returns RESUME_EXECUTION without Planner", async () => {
  const initial = state();
  initial.control.preparedOperation = {
    operationId: "op-1",
    operationType: "reserve",
    operationFingerprint: "operation-fp-1",
    inputSnapshot: { roomId: "room-102" },
    status: "approval_required",
    dependencyFingerprint: "dep-op-1",
    dependencyPaths: ["lifecycle", "control.groundedSelection", "user.operationIntent"],
  };
  const event = {
    eventId: "server-approved-1",
    kind: "server_control",
    sessionId: "session-i5",
    taskId: "task-i5",
    expectedStateRevision: 1,
    occurredAt: NOW,
    payload: {
      kind: "prepared_operation_status_changed",
      operationId: "op-1",
      operationFingerprint: "operation-fp-1",
      status: "approved",
    },
  };
  const serverTrigger = { origin: "server", acceptedEventId: event.eventId };
  const cycle = cycleFor(serverTrigger, "cycle-approved");
  const result = await runHotelPlanningCycle({ state: initial, primaryEvent: event, cycle, capabilities, now: NOW });
  assert.equal(result.kind, "resume_execution");
  assert.equal(result.state.control.preparedOperation.status, "approved");
  assert.equal(result.disposition, "RESUME_EXECUTION");
});

test("STATE_ONLY server control cannot accidentally open a Planner loop", async () => {
  const initial = state();
  const event = {
    eventId: "anchor-clear-1",
    kind: "server_control",
    sessionId: "session-i5",
    taskId: "task-i5",
    expectedStateRevision: 1,
    occurredAt: NOW,
    payload: { kind: "dialogue_anchor_clear", anchorId: "anchor-options-1" },
  };
  const serverTrigger = { origin: "server", acceptedEventId: event.eventId };
  const result = await runHotelPlanningCycle({ state: initial, primaryEvent: event, cycle: cycleFor(serverTrigger, "cycle-state-only"), capabilities, now: NOW });
  assert.equal(result.kind, "no_plan");
  assert.equal(result.disposition, "STATE_ONLY");
  assert.equal(result.state.control.dialogueAnchor, undefined);
});

test("INTERNAL_PREPLAN control is rejected as an independent primary cycle", async () => {
  const initial = state();
  const event = {
    eventId: "fake-ground-primary",
    kind: "server_control",
    sessionId: "session-i5",
    taskId: "task-i5",
    expectedStateRevision: 1,
    occurredAt: NOW,
    payload: {
      kind: "reference_grounded",
      groundedSelection: {
        roomIds: ["room-102"],
        sourceObservationId: "availability-1",
        authority: "server",
        dependencyFingerprint: "ground-fp",
        dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
      },
    },
  };
  const serverTrigger = { origin: "server", acceptedEventId: event.eventId };
  const result = await runHotelPlanningCycle({ state: initial, primaryEvent: event, cycle: cycleFor(serverTrigger, "cycle-internal"), capabilities, now: NOW });
  assert.equal(result.kind, "rejected");
  assert.equal(result.reason, "internal_preplan_cannot_open_primary_cycle");
  assert.equal(result.state.stateRevision, 1);
});
