import { HotelTaskPlanner as BaseHotelTaskPlanner } from "./hotel-task-planner-base.js";
import type { NextStep, PlanningContext } from "./planning.js";
import type { OrchestrationPlanningTrigger } from "./orchestration-trigger.js";

function abortStep(context: PlanningContext): NextStep {
  const state = context.state;
  if (state.execution.status === "executing" || state.execution.status === "confirmed") {
    return { kind: "DEGRADE", reasonCode: "ABORT_TOO_LATE_EXECUTION_COMMITTED", recoverable: false, responseIntent: "operation_abort_too_late" };
  }
  const intentStillActive = state.operationIntent !== undefined && state.operationIntent.status !== "cleared";
  const preparedStillActive = state.preparedOperation !== undefined && state.preparedOperation.status !== "invalidated";
  if (intentStillActive || preparedStillActive) {
    return { kind: "DEGRADE", reasonCode: "ABORT_STATE_TRANSITION_REQUIRED", recoverable: true, responseIntent: "operation_abort_not_applied" };
  }
  return { kind: "RESPOND", responseIntent: "operation_aborted", groundedReferences: [] };
}

function ambiguityStep(trigger: OrchestrationPlanningTrigger): NextStep | undefined {
  const ambiguity = trigger.ambiguityDirective;
  if (!ambiguity) return undefined;
  const mapping = {
    dates: ["dates", "dates"],
    guests: ["guests", "guests"],
    selection: ["selection", "selection"],
    booking_reference: ["booking_reference", "booking_reference"],
    occupancy: ["selection", "other_bounded"],
    operation_intent: ["selection", "other_bounded"],
    other: ["selection", "other_bounded"],
  } as const;
  const [field, anchorKind] = mapping[ambiguity.topic];
  return { kind: "ASK", field, reason: ambiguity.reasonCode, dialogueAnchorSpec: { kind: anchorKind } };
}

function executionFailureStep(context: PlanningContext): NextStep | undefined {
  const state = context.state;
  const trigger = context.trigger as OrchestrationPlanningTrigger;
  if (state.execution.status !== "failed") return undefined;
  const explicitReadOrRetry = trigger.readDirective !== undefined
    || trigger.showOptionsDirective === true
    || trigger.retryDirective !== undefined;
  if (explicitReadOrRetry) return undefined;
  return {
    kind: "DEGRADE",
    reasonCode: state.execution.failureCode ?? "OPERATION_EXECUTION_FAILED",
    recoverable: true,
    responseIntent: "operation_failed",
  };
}

export class HotelTaskPlanner extends BaseHotelTaskPlanner {
  public override plan(context: PlanningContext): NextStep {
    const state = context.state;
    const trigger = context.trigger as OrchestrationPlanningTrigger;

    if (state.execution.status === "confirmed" || state.lifecycle !== "active") return super.plan(context);
    if (trigger.unknownDirective) return { kind: "DEGRADE", reasonCode: "UNINTERPRETABLE_USER_TURN", recoverable: true, responseIntent: "clarify_user_intent" };
    if (trigger.abortDirective) return abortStep(context);
    if (trigger.interactionDirective) return { kind: "RESPOND", responseIntent: trigger.interactionDirective, groundedReferences: [] };
    if (trigger.retryDirective && "targetCurrentOperation" in trigger.retryDirective) {
      return { kind: "DEGRADE", reasonCode: "WRITE_RETRY_NOT_PLANNER_OWNED", recoverable: true, responseIntent: "retry_requires_control_plane" };
    }
    const ambiguity = ambiguityStep(trigger);
    if (ambiguity) return ambiguity;
    if (trigger.readDirective?.kind === "compare_price") return { kind: "DEGRADE", reasonCode: "COMPARE_PRICE_CAPABILITY_UNAVAILABLE", recoverable: true, responseIntent: "compare_price_unsupported" };
    if (trigger.readDirective?.kind === "booking_lookup") return { kind: "DEGRADE", reasonCode: "BOOKING_LOOKUP_CAPABILITY_UNAVAILABLE", recoverable: true, responseIntent: "booking_lookup_unsupported" };
    if (state.execution.status === "executing") return super.plan(context);
    const executionFailure = executionFailureStep(context);
    if (executionFailure) return executionFailure;
    if (state.preparedOperation?.status === "invalidated" && trigger.controlKind === "approval_invalidated") {
      return { kind: "RESPOND", responseIntent: "approval_invalidated", groundedReferences: [{ kind: "operation", operationId: state.preparedOperation.operationId }] };
    }
    return super.plan(context);
  }
}
