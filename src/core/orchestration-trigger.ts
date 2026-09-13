import type { PlanningTrigger, ReadDirective, RetryDirective } from "./planning.js";
import type { InterpreterAmbiguity, InterpreterOutput } from "./semantic-interpreter.js";

export type OrchestrationReadDirective =
  | ReadDirective
  | { kind: "compare_price" }
  | { kind: "booking_lookup" };

export type OrchestrationRetryDirective =
  | RetryDirective
  | { targetCurrentOperation: true; correlationId?: string };

export type OrchestrationPlanningTrigger = Omit<PlanningTrigger, "readDirective" | "retryDirective"> & {
  readDirective?: OrchestrationReadDirective;
  retryDirective?: OrchestrationRetryDirective;
  ambiguityDirective?: InterpreterAmbiguity;
  unknownDirective?: true;
};

export function normalizeInterpreterPlanningTrigger(
  output: Readonly<InterpreterOutput>,
  acceptedEventId?: string,
  groundingAmbiguity?: InterpreterAmbiguity,
): OrchestrationPlanningTrigger {
  const trigger: OrchestrationPlanningTrigger = {
    origin: "user",
    ...(acceptedEventId ? { acceptedEventId } : {}),
  };

  if (output.classification === "unknown") trigger.unknownDirective = true;

  const ambiguity = output.taskSemanticChanges?.ambiguity ?? groundingAmbiguity;
  if (ambiguity) trigger.ambiguityDirective = ambiguity;

  const directives = output.directives;
  if (!directives) return trigger;

  if (directives.retry) {
    if (directives.retry.target === "current_operation") {
      trigger.retryDirective = { targetCurrentOperation: true };
    } else if (directives.retry.target) {
      trigger.retryDirective = { targetCapabilityId: directives.retry.target };
    } else {
      trigger.retryDirective = {};
    }
  }

  const read = directives.readRequest;
  if (read?.kind === "availability" || read?.kind === "quote") trigger.readDirective = { kind: read.kind };
  else if (read?.kind === "compare_price") trigger.readDirective = { kind: "compare_price" };
  else if (read?.kind === "booking_lookup") trigger.readDirective = { kind: "booking_lookup" };
  else if (read?.kind === "knowledge_query") trigger.readDirective = { kind: "knowledge", fields: read.fields ?? [] };
  else if (read?.kind === "show_options") trigger.showOptionsDirective = true;

  if (directives.showOptions) trigger.showOptionsDirective = true;
  if (directives.abortCurrentOperation) trigger.abortDirective = true;
  if (directives.interaction) trigger.interactionDirective = directives.interaction;
  return trigger;
}
