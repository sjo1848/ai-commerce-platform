import { stableStringify } from "./idempotency.js";
import type { DeterministicPlanner, DomainCapabilities, HotelTaskDefinition, NextStep, PlanningContext } from "./planning.js";
import type { DialogueAnchor, InterpreterAmbiguity, InterpreterOutput, PresentedSemanticEntity } from "./semantic-interpreter.js";
import type { SelectionGroundedEvent, UserSemanticEvent } from "./task-events.js";
import { reduceTaskState, type ReductionResult } from "./task-reducer.js";
import type { RoomReference, TaskDependencyKey, TaskStateV1, UserSemanticStatePatch } from "./task-state.js";
import { normalizeInterpreterPlanningTrigger, type OrchestrationPlanningTrigger } from "./orchestration-trigger.js";

export type InterpreterTurnBoundaryMeta = {
  eventId: string;
  sourceRevision: number;
  groundingEventId?: string;
  dialogueAnchor?: DialogueAnchor;
  maxInternalSteps?: number;
};

export type InterpreterTurnBoundaryInput = {
  state: Readonly<TaskStateV1>;
  output: Readonly<InterpreterOutput>;
  planner: DeterministicPlanner;
  taskDefinition: Readonly<HotelTaskDefinition>;
  capabilities: DomainCapabilities;
  meta: InterpreterTurnBoundaryMeta;
};

export type InterpreterTurnBoundarySuccess = {
  ok: true;
  nextState: TaskStateV1;
  trigger: OrchestrationPlanningTrigger;
  nextStep: NextStep;
  semanticReduction?: ReductionResult;
  groundingReduction?: ReductionResult;
  appliedEventIds: readonly string[];
};

export type InterpreterTurnBoundaryFailure = {
  ok: false;
  nextState: TaskStateV1;
  failureCode: string;
  nextStep: Extract<NextStep, { kind: "DEGRADE" }>;
};

export type InterpreterTurnBoundaryResult = InterpreterTurnBoundarySuccess | InterpreterTurnBoundaryFailure;

type SelectionCandidate = { reference: RoomReference; dependencyKey: "requestedSelectionReference" | "operationIntent" };
type GroundingResolution =
  | { kind: "none" }
  | { kind: "ambiguous"; ambiguity: InterpreterAmbiguity }
  | { kind: "grounded"; event: SelectionGroundedEvent };

function fail(state: Readonly<TaskStateV1>, failureCode: string): InterpreterTurnBoundaryFailure {
  return {
    ok: false,
    nextState: structuredClone(state) as TaskStateV1,
    failureCode,
    nextStep: { kind: "DEGRADE", reasonCode: failureCode, recoverable: true, responseIntent: "orchestration_boundary_failure" },
  };
}

function semanticPatch(
  state: Readonly<TaskStateV1>,
  output: Readonly<InterpreterOutput>,
): { patch: UserSemanticStatePatch; contradiction?: string; selectionCandidate?: SelectionCandidate } {
  const changes = output.taskSemanticChanges;
  const patch: UserSemanticStatePatch = {};
  if (changes) {
    for (const key of [
      "requestedGoal", "checkIn", "checkOut", "guests", "requestedRoomCount",
      "requestedSelectionReference", "bookingReference", "operationIntent", "preferences",
    ] as const) {
      const value = changes[key];
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    }
  }

  if (output.directives?.abortCurrentOperation) {
    if (patch.operationIntent?.op === "set") {
      return { patch, contradiction: "ABORT_CONTRADICTS_OPERATION_INTENT_SET" };
    }
    if (!patch.operationIntent
      && state.execution.status !== "executing"
      && state.execution.status !== "confirmed"
      && state.operationIntent
      && state.operationIntent.status !== "cleared") {
      patch.operationIntent = { op: "clear" };
    }
  }

  let selectionCandidate: SelectionCandidate | undefined;
  if (patch.requestedSelectionReference?.op === "set") {
    const nextReference = patch.requestedSelectionReference.value;
    const existingIntentTarget = state.operationIntent?.status === "active" && state.operationIntent.kind === "reserve"
      ? state.operationIntent.targetSemanticReference
      : undefined;
    if (existingIntentTarget && "scope" in existingIntentTarget && !patch.operationIntent
      && stableStringify(existingIntentTarget) !== stableStringify(nextReference)) {
      return { patch, contradiction: "CONFLICTING_SELECTION_REFERENCES" };
    }
    selectionCandidate = { reference: nextReference, dependencyKey: "requestedSelectionReference" };
  }
  if (patch.operationIntent?.op === "set"
    && patch.operationIntent.value.status === "active"
    && patch.operationIntent.value.kind === "reserve"
    && patch.operationIntent.value.targetSemanticReference) {
    const target = patch.operationIntent.value.targetSemanticReference;
    if ("scope" in target) {
      const existingSelection = state.requestedSelectionReference?.value;
      if (!patch.requestedSelectionReference && existingSelection
        && stableStringify(existingSelection) !== stableStringify(target)) {
        return { patch, contradiction: "CONFLICTING_SELECTION_REFERENCES" };
      }
      if (selectionCandidate) {
        if (stableStringify(selectionCandidate.reference) !== stableStringify(target)) {
          return { patch, contradiction: "CONFLICTING_SELECTION_REFERENCES" };
        }
      } else {
        selectionCandidate = { reference: target, dependencyKey: "operationIntent" };
      }
    }
  }

  return { patch, ...(selectionCandidate ? { selectionCandidate } : {}) };
}

function roomForPresentedEntity(state: Readonly<TaskStateV1>, entity: PresentedSemanticEntity): string | undefined {
  if (entity.entityType !== "room" || state.availability.status !== "observed") return undefined;
  if (entity.roomNumber) {
    const matches = state.availability.rooms.filter((room) => room.roomNumber === entity.roomNumber);
    return matches.length === 1 ? matches[0]!.roomId : undefined;
  }
  return undefined;
}

function uniqueRoomNumberMatch(state: Readonly<TaskStateV1>, roomNumber: string): string | undefined {
  if (state.availability.status !== "observed") return undefined;
  const matches = state.availability.rooms.filter((room) => room.roomNumber === roomNumber);
  return matches.length === 1 ? matches[0]!.roomId : undefined;
}

function roomForOrdinal(state: Readonly<TaskStateV1>, ordinal: number, anchor?: DialogueAnchor): string | undefined {
  const anchored = anchor?.presentedEntities?.find((entity) => entity.entityType === "room" && entity.ordinal === ordinal);
  if (anchored) return roomForPresentedEntity(state, anchored);
  return state.availability.status === "observed" ? state.availability.rooms[ordinal - 1]?.roomId : undefined;
}

function resolveRoomReference(
  state: Readonly<TaskStateV1>,
  reference: RoomReference,
  anchor?: DialogueAnchor,
): { roomIds?: readonly string[]; ambiguity?: InterpreterAmbiguity } {
  if (state.availability.status !== "observed" || state.availability.observationRevision === undefined) return {};

  if (reference.kind === "room_number") {
    const roomId = uniqueRoomNumberMatch(state, reference.roomNumber);
    return roomId ? { roomIds: [roomId] } : { ambiguity: { topic: "selection", reasonCode: "ROOM_NUMBER_NOT_UNIQUELY_GROUNDED" } };
  }
  if (reference.kind === "ordinal") {
    const roomId = roomForOrdinal(state, reference.ordinal, anchor);
    return roomId ? { roomIds: [roomId] } : { ambiguity: { topic: "selection", reasonCode: "ORDINAL_OUT_OF_RANGE" } };
  }
  if (reference.kind === "ordinal_set") {
    const roomIds = reference.ordinals.map((ordinal) => roomForOrdinal(state, ordinal, anchor));
    if (roomIds.some((roomId) => roomId === undefined)) return { ambiguity: { topic: "selection", reasonCode: "ORDINAL_SET_OUT_OF_RANGE" } };
    const groundedRoomIds = roomIds as string[];
    return new Set(groundedRoomIds).size === groundedRoomIds.length
      ? { roomIds: groundedRoomIds }
      : { ambiguity: { topic: "selection", reasonCode: "ORDINAL_SET_NOT_UNIQUE" } };
  }
  if (reference.kind === "relation") {
    const presented = anchor?.presentedEntities?.filter((entity): entity is Extract<PresentedSemanticEntity, { entityType: "room" }> => entity.entityType === "room") ?? [];
    const anchorRoomIds = presented.map((entity) => roomForPresentedEntity(state, entity)).filter((item): item is string => Boolean(item));
    const unique = [...new Set(anchorRoomIds)];
    if (unique.length !== 2) return { ambiguity: { topic: "selection", reasonCode: "RELATION_REQUIRES_TWO_GROUNDED_OPTIONS" } };
    if (reference.relation === "both") return { roomIds: unique };
    const focused = anchor?.focusedEntity ? roomForPresentedEntity(state, anchor.focusedEntity) : undefined;
    const current = state.groundedSelection.status === "grounded" && state.groundedSelection.roomIds.length === 1
      ? state.groundedSelection.roomIds[0]
      : undefined;
    const basis = focused ?? current;
    if (!basis || !unique.includes(basis)) return { ambiguity: { topic: "selection", reasonCode: "OTHER_RELATION_HAS_NO_FOCUS" } };
    return { roomIds: [unique.find((roomId) => roomId !== basis)!] };
  }
  if (reference.kind === "ambiguous") return { ambiguity: { topic: "selection", reasonCode: reference.reasonCode } };
  return { ambiguity: { topic: "selection", reasonCode: "DESCRIPTIVE_SELECTION_REQUIRES_EXPLICIT_GROUNDING" } };
}

function selectionGrounding(
  state: Readonly<TaskStateV1>,
  candidate: SelectionCandidate | undefined,
  meta: InterpreterTurnBoundaryMeta,
): GroundingResolution {
  if (!candidate || state.availability.status !== "observed" || state.availability.observationRevision === undefined) return { kind: "none" };
  const resolved = resolveRoomReference(state, candidate.reference, meta.dialogueAnchor);
  if (resolved.ambiguity) return { kind: "ambiguous", ambiguity: resolved.ambiguity };
  if (!resolved.roomIds || resolved.roomIds.length === 0) return { kind: "none" };
  const dependencyKeys: readonly TaskDependencyKey[] = ["availability", candidate.dependencyKey];
  const dependencyFingerprint = `ground:v1:${stableStringify({
    availabilityRevision: state.availability.observationRevision,
    availabilityDependencyFingerprint: state.availability.dependencyFingerprint ?? null,
    reference: candidate.reference,
    dependencyKey: candidate.dependencyKey,
    roomIds: resolved.roomIds,
  })}`;
  return {
    kind: "grounded",
    event: {
      kind: "selection_grounded",
      eventId: meta.groundingEventId ?? `${meta.eventId}:grounding`,
      taskId: state.taskId,
      sessionId: state.sessionId,
      expectedStateRevision: state.stateRevision,
      roomIds: resolved.roomIds,
      basedOnAvailabilityRevision: state.availability.observationRevision,
      dependencyFingerprint,
      dependencyKeys,
    },
  };
}

export function applyInterpreterTurnToPlanner(input: InterpreterTurnBoundaryInput): InterpreterTurnBoundaryResult {
  const maxInternalSteps = input.meta.maxInternalSteps ?? 3;
  let internalSteps = 0;
  const consumeStep = (): boolean => {
    internalSteps += 1;
    return internalSteps <= maxInternalSteps;
  };

  const normalized = semanticPatch(input.state, input.output);
  if (normalized.contradiction) return fail(input.state, normalized.contradiction);

  let nextState = structuredClone(input.state) as TaskStateV1;
  let semanticReduction: ReductionResult | undefined;
  let acceptedEventId: string | undefined;
  const appliedEventIds: string[] = [];

  if (Object.keys(normalized.patch).length > 0) {
    if (!consumeStep()) return fail(nextState, "MAX_INTERNAL_STEPS_EXCEEDED");
    const event: UserSemanticEvent = {
      kind: "user_semantic",
      eventId: input.meta.eventId,
      taskId: nextState.taskId,
      sessionId: nextState.sessionId,
      expectedStateRevision: nextState.stateRevision,
      sourceRevision: input.meta.sourceRevision,
      patch: normalized.patch,
    };
    semanticReduction = reduceTaskState(nextState, event);
    if (!semanticReduction.accepted) return fail(nextState, `SEMANTIC_EVENT_REJECTED_${semanticReduction.rejectionReason ?? "UNKNOWN"}`);
    nextState = semanticReduction.nextState;
    acceptedEventId = event.eventId;
    appliedEventIds.push(event.eventId);
  }

  let groundingReduction: ReductionResult | undefined;
  let groundingAmbiguity: InterpreterAmbiguity | undefined;
  const grounding = selectionGrounding(nextState, normalized.selectionCandidate, input.meta);
  if (grounding.kind === "ambiguous") groundingAmbiguity = grounding.ambiguity;
  else if (grounding.kind === "grounded") {
    if (!consumeStep()) return fail(nextState, "MAX_INTERNAL_STEPS_EXCEEDED");
    groundingReduction = reduceTaskState(nextState, grounding.event);
    if (!groundingReduction.accepted) return fail(nextState, `GROUNDING_EVENT_REJECTED_${groundingReduction.rejectionReason ?? "UNKNOWN"}`);
    nextState = groundingReduction.nextState;
    appliedEventIds.push(grounding.event.eventId);
  }

  const trigger = normalizeInterpreterPlanningTrigger(input.output, acceptedEventId, groundingAmbiguity);
  if (!consumeStep()) return fail(nextState, "MAX_INTERNAL_STEPS_EXCEEDED");
  const planningContext: PlanningContext = {
    state: nextState,
    trigger: trigger as PlanningContext["trigger"],
    taskDefinition: input.taskDefinition,
    capabilities: input.capabilities,
  };
  const nextStep = input.planner.plan(planningContext);

  return {
    ok: true,
    nextState,
    trigger,
    nextStep,
    ...(semanticReduction ? { semanticReduction } : {}),
    ...(groundingReduction ? { groundingReduction } : {}),
    appliedEventIds,
  };
}
