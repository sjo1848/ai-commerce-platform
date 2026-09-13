import type { ModelProvider } from "./model-provider.js";
import { safeProviderCategory } from "./model-provider.js";
import type { DeterministicPlanner, DomainCapabilities, HotelTaskDefinition, NextStep } from "./planning.js";
import type { DialogueAnchor, InterpreterTemporalContext } from "./semantic-interpreter.js";
import { HOTEL_SEMANTIC_CONTRACT_V1, projectTaskStateForInterpreter } from "./semantic-interpreter.js";
import { buildSemanticInterpreterRequest } from "./semantic-interpreter-adapter.js";
import { validateInterpreterOutput } from "./semantic-interpreter-validation.js";
import { applyInterpreterTurnToPlanner } from "./interpreter-turn-boundary.js";
import type { TaskStateV1 } from "./task-state.js";

export type J01ProviderPreflightReceipt = Readonly<{
  inferenceCount: 1;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  estimatedCostUsd?: number;
  providerNeurons?: number;
  cachedInputTokens?: number;
}>;

export type J01ProviderPreflightFailureCode =
  | "J01_PREFLIGHT_STATE_NOT_CLEAN"
  | "J01_PREFLIGHT_PROVIDER_FAILURE"
  | "J01_PREFLIGHT_PROVIDER_IDENTITY_MISSING"
  | "J01_PREFLIGHT_SEMANTIC_VALIDATION_FAILED"
  | "J01_PREFLIGHT_INTERPRETER_BOUNDARY_REJECTED"
  | "J01_PREFLIGHT_UNEXPECTED_NEXT_STEP"
  | "J01_PREFLIGHT_WRITE_STEP_BLOCKED"
  | "J01_PREFLIGHT_OPERATIONAL_STATE_CHANGED";

export type J01ProviderPreflightResult =
  | {
      ok: true;
      nextState: TaskStateV1;
      nextStep: Extract<NextStep, { kind: "CALL_TOOL" }>;
      receipt: J01ProviderPreflightReceipt;
    }
  | {
      ok: false;
      failureCode: J01ProviderPreflightFailureCode;
      providerCategory?: string;
      validationMessage?: string;
    };

export type J01ProviderPreflightInput = {
  state: Readonly<TaskStateV1>;
  userMessage: string;
  temporalContext: Readonly<InterpreterTemporalContext>;
  provider: ModelProvider;
  planner: DeterministicPlanner;
  taskDefinition: Readonly<HotelTaskDefinition>;
  capabilities: DomainCapabilities;
  meta: Readonly<{
    eventId: string;
    sourceRevision: number;
    dialogueAnchor?: DialogueAnchor;
  }>;
};

function cleanJ01State(state: Readonly<TaskStateV1>): boolean {
  const preparedActive = state.preparedOperation !== undefined && state.preparedOperation.status !== "invalidated";
  return state.lifecycle === "active"
    && state.execution.status === "not_started"
    && state.pendingToolInvocation?.status !== "pending"
    && !preparedActive
    && state.availability.status === "not_queried"
    && state.quote.status === "not_queried"
    && state.groundedSelection.status === "none"
    && state.bookings.length === 0;
}

function receipt(result: Awaited<ReturnType<ModelProvider["completeStructured"]>>): J01ProviderPreflightReceipt | undefined {
  const model = result.model?.trim();
  if (!model) return undefined;
  return {
    inferenceCount: 1,
    model,
    ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
    ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
    ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
    ...(result.estimatedCostUsd !== undefined ? { estimatedCostUsd: result.estimatedCostUsd } : {}),
    ...(result.providerNeurons !== undefined ? { providerNeurons: result.providerNeurons } : {}),
    ...(result.cachedInputTokens !== undefined ? { cachedInputTokens: result.cachedInputTokens } : {}),
  };
}

/**
 * Validation-only J01 provider preflight.
 *
 * This boundary deliberately stops before Core/Policy admission. It may perform
 * exactly one structured semantic-provider call, validate that output against
 * ACP-3, reduce the semantic patch in memory, and ask the deterministic Planner
 * what would happen next. A successful preflight requires the next action to be
 * the read-only availability capability. No tool invocation, approval issuance,
 * approval consumption, persistence, HMS call, or response publication occurs.
 */
export async function runJ01ProviderSemanticPreflight(
  input: Readonly<J01ProviderPreflightInput>,
): Promise<J01ProviderPreflightResult> {
  if (!cleanJ01State(input.state)) return { ok: false, failureCode: "J01_PREFLIGHT_STATE_NOT_CLEAN" };

  const interpreterInput = {
    currentUserMessage: input.userMessage,
    taskContextProjection: projectTaskStateForInterpreter(input.state),
    ...(input.meta.dialogueAnchor ? { dialogueAnchor: input.meta.dialogueAnchor } : {}),
    temporalContext: input.temporalContext,
    domainSemanticContract: HOTEL_SEMANTIC_CONTRACT_V1,
  } as const;

  let providerResult: Awaited<ReturnType<ModelProvider["completeStructured"]>>;
  try {
    providerResult = await input.provider.completeStructured(buildSemanticInterpreterRequest(interpreterInput));
  } catch (error) {
    const providerCategory = safeProviderCategory(error);
    return {
      ok: false,
      failureCode: "J01_PREFLIGHT_PROVIDER_FAILURE",
      ...(providerCategory ? { providerCategory } : {}),
    };
  }

  const providerReceipt = receipt(providerResult);
  if (!providerReceipt) return { ok: false, failureCode: "J01_PREFLIGHT_PROVIDER_IDENTITY_MISSING" };

  const validated = validateInterpreterOutput(providerResult.value, interpreterInput);
  if (!validated.ok) {
    return {
      ok: false,
      failureCode: "J01_PREFLIGHT_SEMANTIC_VALIDATION_FAILED",
      validationMessage: validated.message,
    };
  }

  const planned = applyInterpreterTurnToPlanner({
    state: input.state,
    output: validated.value,
    planner: input.planner,
    taskDefinition: input.taskDefinition,
    capabilities: input.capabilities,
    meta: {
      eventId: input.meta.eventId,
      sourceRevision: input.meta.sourceRevision,
      ...(input.meta.dialogueAnchor ? { dialogueAnchor: input.meta.dialogueAnchor } : {}),
    },
  });
  if (!planned.ok) return { ok: false, failureCode: "J01_PREFLIGHT_INTERPRETER_BOUNDARY_REJECTED" };

  if (planned.nextStep.kind === "CALL_TOOL" && planned.nextStep.effectClass === "write") {
    return { ok: false, failureCode: "J01_PREFLIGHT_WRITE_STEP_BLOCKED" };
  }
  if (planned.nextStep.kind !== "CALL_TOOL"
    || planned.nextStep.capabilityId !== "availability"
    || planned.nextStep.effectClass !== "read") {
    return { ok: false, failureCode: "J01_PREFLIGHT_UNEXPECTED_NEXT_STEP" };
  }

  const operationalStateChanged = planned.nextState.pendingToolInvocation?.status === "pending"
    || (planned.nextState.preparedOperation !== undefined && planned.nextState.preparedOperation.status !== "invalidated")
    || planned.nextState.execution.status !== "not_started";
  if (operationalStateChanged) return { ok: false, failureCode: "J01_PREFLIGHT_OPERATIONAL_STATE_CHANGED" };

  return {
    ok: true,
    nextState: planned.nextState,
    nextStep: planned.nextStep,
    receipt: providerReceipt,
  };
}
