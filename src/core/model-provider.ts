import type { JsonSchema } from "./types.js";

export type ModelProviderMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type StructuredModelRequest = {
  messages: readonly ModelProviderMessage[];
  schema: JsonSchema;
  maxTokens?: number;
  temperature?: number;
  label?: string;
  /** Server-owned, adapter-only affinity key. It is never model-visible. */
  sessionAffinity?: string;
  /** Local prompt assembly measurements; never sent to the model. */
  promptTelemetry?: ModelPromptTelemetry;
};

export type ModelPromptTelemetry = {
  routeOrdinal: number;
  inferenceOrdinal: number;
  repairTrigger: boolean;
  initialValidity?: "valid" | "invalid";
  validationErrorFamily?: string;
  systemBytes: number;
  systemRulesBytes: number;
  capabilityRequirementsBytes: number;
  toolTextBytes: number;
  modelVisibleStateBytes: number;
  historyTextBytes: number;
  examplesAndInstructionsBytes: number;
  userMessageBytes: number;
};

export type StructuredModelResult = {
  value: unknown;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  estimatedCostUsd?: number;
  /** Exact provider-reported consumption; never reconstructed by Core. */
  providerNeurons?: number;
  /** Exact provider-reported cached input tokens, when supplied. */
  cachedInputTokens?: number;
  logId?: string;
};

export interface ModelProvider {
  completeStructured(request: StructuredModelRequest): Promise<StructuredModelResult>;
}

export class ModelProviderError extends Error {
  constructor(
    message: string,
    public readonly causeName?: string,
    public readonly underlyingCauseName?: string,
  ) {
    super(message);
    this.name = "ModelProviderError";
  }
}

const SAFE_PROVIDER_CATEGORY = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

export function safeProviderCategory(error: unknown): string | undefined {
  const candidate = error instanceof ModelProviderError ? error.causeName : undefined;
  return candidate && SAFE_PROVIDER_CATEGORY.test(candidate) ? candidate : undefined;
}

export function safeUnderlyingProviderCategory(error: unknown): string | undefined {
  const candidate = error instanceof ModelProviderError
    ? error.underlyingCauseName ?? error.causeName
    : undefined;
  return candidate && SAFE_PROVIDER_CATEGORY.test(candidate) ? candidate : undefined;
}
