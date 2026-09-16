import type { NextStep } from "./contracts.js";
import { planHotelTask, type HotelPlanningContext } from "./hotel-task-planner.js";

/**
 * Cross-boundary Planner entry. The domain Planner remains unchanged for
 * normal business progression; server/tool failure primary causes are consumed
 * here so unchanged business state can never auto-reissue the same CALL_TOOL.
 */
export async function planHotelTaskFromCause(context: HotelPlanningContext): Promise<NextStep> {
  if (context.trigger.controlKind === "tool_control_failure") {
    return {
      kind: "DEGRADE",
      reasonCode: "tool_control_failure",
      recoverable: true,
      responseIntent: "tool_operation_unavailable",
    };
  }

  if (context.trigger.observationKind === "failure") {
    return {
      kind: "DEGRADE",
      reasonCode: "tool_observation_failure",
      recoverable: true,
      responseIntent: "tool_operation_failed",
    };
  }

  return planHotelTask(context);
}
