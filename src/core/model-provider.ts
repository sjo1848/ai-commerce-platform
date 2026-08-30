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
};

export type StructuredModelResult = {
  value: unknown;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  logId?: string;
};

export interface ModelProvider {
  completeStructured(request: StructuredModelRequest): Promise<StructuredModelResult>;
}

export class ModelProviderError extends Error {
  constructor(message: string, public readonly causeName?: string) {
    super(message);
    this.name = "ModelProviderError";
  }
}
