import type {
  NextStep,
  OrchestrationCycleRecord,
  OrchestrationDisposition,
  PlanningTrigger,
  TaskState,
} from "./contracts.js";
import type {
  ServerControlEvent,
  ServerControlPayload,
  TaskEvent,
  TaskStateReduction,
} from "./events.js";
import type { DomainCapabilities, HotelTaskDefinition } from "./hotel-task-definition.js";
import { HOTEL_TASK_DEFINITION_V1 } from "./hotel-task-definition.js";
import { planHotelTask } from "./hotel-task-planner.js";
import { resolveHotelReferences, type GroundingDiagnostic } from "./reference-resolver.js";
import { reduceTaskState } from "./task-state-reducer.js";

const MAX_INTERNAL_GROUNDING_STEPS = 2;
const ID_MAX = 200;

export type HotelPlanningCycleInput = {
  state: Readonly<TaskState>;
  primaryEvent: TaskEvent;
  trigger?: Readonly<PlanningTrigger>;
  cycle: Readonly<OrchestrationCycleRecord>;
  capabilities: DomainCapabilities;
  taskDefinition?: HotelTaskDefinition;
  now: string;
};

export type HotelPlanningCycleResult =
  | {
      kind: "planned";
      state: TaskState;
      cycle: OrchestrationCycleRecord;
      primaryReduction: TaskStateReduction;
      internalGroundingEvents: readonly ServerControlEvent[];
      groundingDiagnostics: readonly GroundingDiagnostic[];
      planningTrigger: PlanningTrigger;
      nextStep: NextStep;
    }
  | {
      kind: "rejected";
      state: TaskState;
      cycle: OrchestrationCycleRecord;
      primaryReduction?: TaskStateReduction;
      reason: string;
    }
  | {
      kind: "no_plan";
      state: TaskState;
      cycle: OrchestrationCycleRecord;
      primaryReduction: TaskStateReduction;
      disposition: Exclude<OrchestrationDisposition, "PLANNING_TRIGGER" | "RESUME_EXECUTION">;
    }
  | {
      kind: "resume_execution";
      state: TaskState;
      cycle: OrchestrationCycleRecord;
      primaryReduction: TaskStateReduction;
      disposition: "RESUME_EXECUTION";
    }
  | {
      kind: "already_planned";
      state: TaskState;
      cycle: OrchestrationCycleRecord;
    };

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= ID_MAX;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function primaryOrigin(event: TaskEvent): PlanningTrigger["origin"] {
  if (event.kind === "user_semantic") return "user";
  if (event.kind === "tool_observation") return "tool";
  return "server";
}

function directiveSnapshot(trigger: Readonly<PlanningTrigger>): OrchestrationCycleRecord["directives"] {
  return {
    ...(trigger.retryDirective ? { retryDirective: structuredClone(trigger.retryDirective) } : {}),
    ...(trigger.readDirective ? { readDirective: structuredClone(trigger.readDirective) } : {}),
    ...(trigger.showOptionsDirective !== undefined ? { showOptionsDirective: trigger.showOptionsDirective } : {}),
    ...(trigger.abortDirective !== undefined ? { abortDirective: trigger.abortDirective } : {}),
    ...(trigger.interactionDirective ? { interactionDirective: trigger.interactionDirective } : {}),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createOrchestrationCycleRecord(args: {
  cycleId: string;
  trigger: Readonly<PlanningTrigger>;
  createdAt: string;
}): OrchestrationCycleRecord {
  if (!boundedId(args.cycleId) || !boundedId(args.trigger.acceptedEventId) || !validTimestamp(args.createdAt)) {
    throw new TypeError("Invalid orchestration cycle identity");
  }
  return Object.freeze({
    cycleId: args.cycleId,
    acceptedEventId: args.trigger.acceptedEventId,
    origin: args.trigger.origin,
    status: "accepted" as const,
    directives: Object.freeze(directiveSnapshot(args.trigger)),
    ...(args.trigger.correlationId ? { correlationId: args.trigger.correlationId } : {}),
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  });
}

function updatedCycle(
  cycle: Readonly<OrchestrationCycleRecord>,
  status: OrchestrationCycleRecord["status"],
  now: string,
): OrchestrationCycleRecord {
  return Object.freeze({ ...cycle, status, updatedAt: now });
}

function cycleMatches(
  cycle: Readonly<OrchestrationCycleRecord>,
  event: TaskEvent,
  trigger: Readonly<PlanningTrigger> | undefined,
): boolean {
  if (cycle.acceptedEventId !== event.eventId || cycle.origin !== primaryOrigin(event)) return false;
  if (!trigger) return event.kind === "server_control";
  return (
    trigger.acceptedEventId === event.eventId &&
    trigger.origin === primaryOrigin(event) &&
    cycle.correlationId === trigger.correlationId &&
    sameJson(cycle.directives, directiveSnapshot(trigger))
  );
}

export function serverControlDisposition(payload: ServerControlPayload | unknown): OrchestrationDisposition | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof (payload as { kind?: unknown }).kind !== "string") return undefined;
  const value = payload as { kind: string; status?: unknown; lifecycle?: unknown };
  switch (value.kind) {
    case "reference_grounded":
    case "booking_reference_grounded":
      return "INTERNAL_PREPLAN";
    case "invocation_recorded":
    case "invocation_dispatched":
    case "invocation_terminal":
    case "prepared_operation_recorded":
    case "dialogue_anchor_set":
    case "dialogue_anchor_clear":
      return "STATE_ONLY";
    case "prepared_operation_status_changed":
      if (value.status === "approved") return "RESUME_EXECUTION";
      if (value.status === "approval_required" || value.status === "invalidated") return "PLANNING_TRIGGER";
      return undefined;
    case "lifecycle_changed":
      if (value.lifecycle === "completed" || value.lifecycle === "abandoned" || value.lifecycle === "superseded") return "TERMINAL_NO_PLAN";
      if (value.lifecycle === "active") return "STATE_ONLY";
      return undefined;
    default:
      return undefined;
  }
}

function normalizedTrigger(event: TaskEvent, trigger: Readonly<PlanningTrigger>): PlanningTrigger {
  return {
    origin: primaryOrigin(event),
    acceptedEventId: event.eventId,
    ...(trigger.correlationId ? { correlationId: trigger.correlationId } : {}),
    ...directiveSnapshot(trigger),
    ...(event.kind === "tool_observation" ? { observationKind: event.payload.kind } : {}),
    ...(event.kind === "server_control" ? { controlKind: event.payload.kind } : {}),
  };
}

function groundingEvent(
  cycle: Readonly<OrchestrationCycleRecord>,
  state: Readonly<TaskState>,
  primaryEvent: TaskEvent,
  payload: Extract<ServerControlPayload, { kind: "reference_grounded" | "booking_reference_grounded" }>,
  now: string,
): ServerControlEvent {
  const suffix = payload.kind === "reference_grounded" ? "room" : "booking";
  return {
    eventId: `${cycle.cycleId}:ground:${suffix}`,
    kind: "server_control",
    sessionId: state.sessionId,
    taskId: state.taskId,
    expectedStateRevision: state.stateRevision,
    occurredAt: now,
    causationId: primaryEvent.eventId,
    payload,
  };
}

function rejected(
  state: Readonly<TaskState>,
  cycle: Readonly<OrchestrationCycleRecord>,
  now: string,
  reason: string,
  primaryReduction?: TaskStateReduction,
): HotelPlanningCycleResult {
  return {
    kind: "rejected",
    state: state as TaskState,
    cycle: updatedCycle(cycle, "failed", now),
    ...(primaryReduction ? { primaryReduction } : {}),
    reason,
  };
}

function recoveredPrimaryReduction(state: Readonly<TaskState>, event: TaskEvent): TaskStateReduction | undefined {
  if (event.sessionId !== state.sessionId || event.taskId !== state.taskId) return undefined;
  if (!state.recentEventIds.includes(event.eventId)) return undefined;
  return {
    state: state as TaskState,
    accepted: true,
    material: false,
    duplicate: true,
    invalidations: [],
  };
}

/**
 * Pure ACP-3.0 orchestration kernel for one accepted primary cause. The caller
 * is responsible for durably storing each returned cycle transition before any
 * later external side effect. A recovered `reduced` cycle must be paired with a
 * TaskState that already contains the accepted primary event; historical text
 * is never reinterpreted to reconstruct directives.
 */
export async function runHotelPlanningCycle(input: HotelPlanningCycleInput): Promise<HotelPlanningCycleResult> {
  if (!validTimestamp(input.now)) return rejected(input.state, input.cycle, input.now, "invalid_cycle_timestamp");
  if (!cycleMatches(input.cycle, input.primaryEvent, input.trigger)) {
    return rejected(input.state, input.cycle, input.now, "cycle_primary_cause_mismatch");
  }
  if (input.cycle.status === "planned" || input.cycle.status === "completed") {
    return { kind: "already_planned", state: input.state as TaskState, cycle: input.cycle as OrchestrationCycleRecord };
  }
  if (input.cycle.status === "failed") return rejected(input.state, input.cycle, input.now, "cycle_already_failed");

  let serverDisposition: OrchestrationDisposition | undefined;
  if (input.primaryEvent.kind === "server_control") {
    serverDisposition = serverControlDisposition(input.primaryEvent.payload);
    if (!serverDisposition) return rejected(input.state, input.cycle, input.now, "unknown_server_control_disposition");
    if (serverDisposition === "INTERNAL_PREPLAN") return rejected(input.state, input.cycle, input.now, "internal_preplan_cannot_open_primary_cycle");
  }

  let primaryReduction: TaskStateReduction;
  let cycleAfterReduce: OrchestrationCycleRecord;
  if (input.cycle.status === "reduced") {
    const recovered = recoveredPrimaryReduction(input.state, input.primaryEvent);
    if (!recovered) return rejected(input.state, input.cycle, input.now, "reduced_cycle_state_mismatch");
    primaryReduction = recovered;
    cycleAfterReduce = input.cycle as OrchestrationCycleRecord;
  } else {
    primaryReduction = reduceTaskState(input.state, input.primaryEvent);
    if (!primaryReduction.accepted) return rejected(input.state, input.cycle, input.now, `primary_reducer_rejected:${primaryReduction.rejection ?? "unknown"}`, primaryReduction);
    cycleAfterReduce = updatedCycle(input.cycle, "reduced", input.now);
  }

  if (input.primaryEvent.kind === "server_control") {
    if (serverDisposition === "RESUME_EXECUTION") {
      return { kind: "resume_execution", state: primaryReduction.state, cycle: cycleAfterReduce, primaryReduction, disposition: serverDisposition };
    }
    if (serverDisposition !== "PLANNING_TRIGGER") {
      return { kind: "no_plan", state: primaryReduction.state, cycle: cycleAfterReduce, primaryReduction, disposition: serverDisposition! };
    }
    if (!input.trigger) return rejected(primaryReduction.state, cycleAfterReduce, input.now, "planning_trigger_missing", primaryReduction);
  } else if (!input.trigger) {
    return rejected(primaryReduction.state, cycleAfterReduce, input.now, "planning_trigger_missing", primaryReduction);
  }

  let state = primaryReduction.state;
  const resolution = await resolveHotelReferences(state);
  if (resolution.instructions.length > MAX_INTERNAL_GROUNDING_STEPS) {
    return rejected(state, cycleAfterReduce, input.now, "internal_grounding_budget_exceeded", primaryReduction);
  }

  const groundingEvents: ServerControlEvent[] = [];
  for (const instruction of resolution.instructions) {
    const event = groundingEvent(cycleAfterReduce, state, input.primaryEvent, instruction, input.now);
    if (serverControlDisposition(event.payload) !== "INTERNAL_PREPLAN") {
      return rejected(state, cycleAfterReduce, input.now, "grounding_disposition_mismatch", primaryReduction);
    }
    const reduction = reduceTaskState(state, event);
    if (!reduction.accepted) {
      return rejected(state, cycleAfterReduce, input.now, `grounding_reducer_rejected:${reduction.rejection ?? "unknown"}`, primaryReduction);
    }
    state = reduction.state;
    groundingEvents.push(event);
  }

  const trigger = normalizedTrigger(input.primaryEvent, input.trigger!);
  const nextStep = await planHotelTask({
    state,
    trigger,
    taskDefinition: input.taskDefinition ?? HOTEL_TASK_DEFINITION_V1,
    capabilities: input.capabilities,
  });
  return {
    kind: "planned",
    state,
    cycle: updatedCycle(cycleAfterReduce, "planned", input.now),
    primaryReduction,
    internalGroundingEvents: groundingEvents,
    groundingDiagnostics: resolution.diagnostics,
    planningTrigger: trigger,
    nextStep,
  };
}
