import type { DeterministicPlanner, DomainCapabilities, HotelTaskDefinition, NextStep, PlanningTrigger } from "./planning.js";
import { mapToolOutcomeToTaskEvent, type ToolOutcomeEnvelope } from "./observation-mapper.js";
import { reduceTaskState, type ReductionResult } from "./task-reducer.js";
import type { TaskEvent } from "./task-events.js";
import type { TaskStateV1 } from "./task-state.js";

export type ObservationReplanInput = {
  state: Readonly<TaskStateV1>;
  envelope: Readonly<ToolOutcomeEnvelope>;
  planner: DeterministicPlanner;
  taskDefinition: Readonly<HotelTaskDefinition>;
  capabilities: DomainCapabilities;
};

export type ObservationReplanSuccess = {
  ok: true;
  nextState: TaskStateV1;
  mappedEvent: TaskEvent;
  reduction: ReductionResult;
  trigger: PlanningTrigger;
  nextStep: NextStep;
};

export type ObservationReplanFailure = {
  ok: false;
  nextState: TaskStateV1;
  failureCode: string;
  nextStep: Extract<NextStep, { kind: "DEGRADE" }>;
};

export type ObservationReplanResult = ObservationReplanSuccess | ObservationReplanFailure;

function fail(state: Readonly<TaskStateV1>, failureCode: string, responseIntent: string): ObservationReplanFailure {
  return {
    ok: false,
    nextState: structuredClone(state) as TaskStateV1,
    failureCode,
    nextStep: { kind: "DEGRADE", reasonCode: failureCode, recoverable: true, responseIntent },
  };
}

function observationKind(event: Readonly<TaskEvent>): PlanningTrigger["observationKind"] | undefined {
  if (event.kind === "availability_observed" || event.kind === "availability_failed"
    || event.kind === "quote_observed" || event.kind === "quote_failed"
    || event.kind === "booking_created" || event.kind === "booking_cancelled"
    || event.kind === "booking_modified" || event.kind === "operation_execution_failed") return event.kind;
  if (event.kind === "bookings_created") return "booking_created";
  if (event.kind === "bookings_cancelled") return "booking_cancelled";
  if (event.kind === "operation_partial_outcome") return "operation_execution_failed";
  return undefined;
}

export function applyToolOutcomeToPlanner(input: ObservationReplanInput): ObservationReplanResult {
  const mapped = mapToolOutcomeToTaskEvent(input.state, input.envelope);
  if (!mapped.ok) return fail(input.state, mapped.failureCode, "tool_result_invalid");

  const normalizedKind = observationKind(mapped.event);
  if (!normalizedKind) return fail(input.state, "OBSERVATION_TRIGGER_UNSUPPORTED", "tool_result_invalid");

  const reduction = reduceTaskState(input.state, mapped.event);
  if (!reduction.accepted) {
    const code = `OBSERVATION_REDUCER_REJECTED_${reduction.rejectionReason ?? "UNKNOWN"}`;
    return fail(input.state, code, reduction.rejectionReason === "STALE_DEPENDENCY" ? "stale_tool_result_ignored" : "tool_result_rejected");
  }

  const trigger: PlanningTrigger = {
    origin: "tool",
    acceptedEventId: mapped.event.eventId,
    observationKind: normalizedKind,
  };
  const nextStep = input.planner.plan({
    state: reduction.nextState,
    trigger,
    taskDefinition: input.taskDefinition,
    capabilities: input.capabilities,
  });
  return {
    ok: true,
    nextState: reduction.nextState,
    mappedEvent: mapped.event,
    reduction,
    trigger,
    nextStep,
  };
}
