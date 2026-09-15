import test from "node:test";
import assert from "node:assert/strict";
import { createOrchestrationCycleRecord, runHotelPlanningCycle } from "../dist/cognitive/orchestration-cycle.js";
import { reduceTaskState } from "../dist/cognitive/task-state-reducer.js";
import { hotelDomainCapabilities } from "../dist/cognitive/hotel-task-definition.js";

const NOW = "2026-09-15T22:30:00.000Z";
const capabilities = hotelDomainCapabilities();

function state() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-cycle-record",
    taskId: "task-cycle-record",
    lifecycle: "active",
    stateRevision: 2,
    recentEventIds: [],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      preferences: [],
    },
    observations: { executionResults: [], failures: [] },
    control: {},
    provenance: {},
  };
}

function event() {
  return {
    eventId: "user-cycle-record",
    kind: "user_semantic",
    sessionId: "session-cycle-record",
    taskId: "task-cycle-record",
    expectedStateRevision: 2,
    occurredAt: NOW,
    payload: {},
  };
}

test("accepted cycle can recover trigger directives from durable cycle record with no external PlanningTrigger", async () => {
  const primary = event();
  const trigger = {
    origin: "user",
    acceptedEventId: primary.eventId,
    readDirective: { kind: "availability" },
    showOptionsDirective: true,
  };
  const cycle = createOrchestrationCycleRecord({ cycleId: "cycle-owned-trigger", trigger, createdAt: NOW });

  const result = await runHotelPlanningCycle({ state: state(), primaryEvent: primary, cycle, capabilities, now: NOW });
  assert.equal(result.kind, "planned");
  assert.deepEqual(result.planningTrigger.readDirective, { kind: "availability" });
  assert.equal(result.planningTrigger.showOptionsDirective, true);
  assert.equal(result.planningTrigger.acceptedEventId, primary.eventId);
  assert.equal(result.cycle.status, "planned");
  assert.deepEqual(result.cycle.plannedStep, result.nextStep);
  assert.equal(result.cycle.plannedAtStateRevision, result.state.stateRevision);
});

test("reduced cycle resumes from cycle-owned directives without historical trigger reconstruction", async () => {
  const primary = event();
  const trigger = { origin: "user", acceptedEventId: primary.eventId, interactionDirective: "help" };
  const acceptedCycle = createOrchestrationCycleRecord({ cycleId: "cycle-reduced-owned-trigger", trigger, createdAt: NOW });
  const reduced = reduceTaskState(state(), primary);
  assert.equal(reduced.accepted, true);
  const cycle = { ...acceptedCycle, status: "reduced", updatedAt: NOW };

  const result = await runHotelPlanningCycle({ state: reduced.state, primaryEvent: primary, cycle, capabilities, now: NOW });
  assert.equal(result.kind, "planned");
  assert.equal(result.primaryReduction.duplicate, true);
  assert.equal(result.planningTrigger.interactionDirective, "help");
  assert.equal(result.nextStep.kind, "RESPOND");
  assert.equal(result.nextStep.responseIntent, "interaction_help");
});

test("planned cycle returns persisted bounded NextStep after crash instead of invoking Planner again to reconstruct it", async () => {
  const primary = event();
  const trigger = { origin: "user", acceptedEventId: primary.eventId, readDirective: { kind: "availability" } };
  const initial = await runHotelPlanningCycle({
    state: state(),
    primaryEvent: primary,
    trigger,
    cycle: createOrchestrationCycleRecord({ cycleId: "cycle-planned-replay", trigger, createdAt: NOW }),
    capabilities,
    now: NOW,
  });
  assert.equal(initial.kind, "planned");

  const recovered = await runHotelPlanningCycle({
    state: initial.state,
    primaryEvent: primary,
    cycle: initial.cycle,
    capabilities,
    now: NOW,
  });
  assert.equal(recovered.kind, "already_planned");
  assert.deepEqual(recovered.nextStep, initial.nextStep);
  assert.notEqual(recovered.nextStep, initial.cycle.plannedStep);
  assert.equal(recovered.cycle.status, "planned");
});

test("corrupt planned cycle without persisted step fails closed", async () => {
  const primary = event();
  const trigger = { origin: "user", acceptedEventId: primary.eventId };
  const cycle = {
    ...createOrchestrationCycleRecord({ cycleId: "cycle-corrupt-planned", trigger, createdAt: NOW }),
    status: "planned",
    plannedAtStateRevision: 2,
    updatedAt: NOW,
  };
  const result = await runHotelPlanningCycle({ state: state(), primaryEvent: primary, cycle, capabilities, now: NOW });
  assert.equal(result.kind, "rejected");
  assert.equal(result.reason, "planned_cycle_missing_step");
});

test("cycle creation rejects invalid runtime origin and overlong correlation identity", () => {
  assert.throws(
    () => createOrchestrationCycleRecord({ cycleId: "bad-origin", trigger: { origin: "model", acceptedEventId: "e1" }, createdAt: NOW }),
    /Invalid orchestration cycle identity/,
  );
  assert.throws(
    () => createOrchestrationCycleRecord({ cycleId: "bad-correlation", trigger: { origin: "user", acceptedEventId: "e1", correlationId: "x".repeat(201) }, createdAt: NOW }),
    /Invalid orchestration cycle identity/,
  );
});
