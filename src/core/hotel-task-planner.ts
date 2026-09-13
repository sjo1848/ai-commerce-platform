import { HotelTaskPlanner as BaseHotelTaskPlanner } from "./hotel-task-planner-base.js";
import type { NextStep, PlanningContext } from "./planning.js";

function abortStep(context: PlanningContext): NextStep {
  const state = context.state;
  if (state.execution.status === "executing" || state.execution.status === "confirmed") {
    return {
      kind: "DEGRADE",
      reasonCode: "ABORT_TOO_LATE_EXECUTION_COMMITTED",
      recoverable: false,
      responseIntent: "operation_abort_too_late",
    };
  }
  const intentStillActive = state.operationIntent?.status === "active";
  const preparedStillActive = state.preparedOperation !== undefined && state.preparedOperation.status !== "invalidated";
  if (intentStillActive || preparedStillActive) {
    return {
      kind: "DEGRADE",
      reasonCode: "ABORT_STATE_TRANSITION_REQUIRED",
      recoverable: true,
      responseIntent: "operation_abort_not_applied",
    };
  }
  return { kind: "RESPOND", responseIntent: "operation_aborted", groundedReferences: [] };
}

export class HotelTaskPlanner extends BaseHotelTaskPlanner {
  public override plan(context: PlanningContext): NextStep {
    const state = context.state;

    if (state.execution.status === "confirmed" || state.lifecycle !== "active") {
      return super.plan(context);
    }

    if (context.trigger.abortDirective) return abortStep(context);

    if (context.trigger.interactionDirective) {
      return { kind: "RESPOND", responseIntent: context.trigger.interactionDirective, groundedReferences: [] };
    }

    if (state.execution.status === "executing") return super.plan(context);

    if (state.preparedOperation?.status === "invalidated" && context.trigger.controlKind === "approval_invalidated") {
      return {
        kind: "RESPOND",
        responseIntent: "approval_invalidated",
        groundedReferences: [{ kind: "operation", operationId: state.preparedOperation.operationId }],
      };
    }

    return super.plan(context);
  }
}
