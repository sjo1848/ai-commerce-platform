import { ModelProviderError, type ModelProvider, type StructuredModelRequest, type StructuredModelResult } from "../core/model-provider.js";

export interface WorkersAiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
  readonly aiGatewayLogId?: string;
}

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export type WorkersAiModelProviderOptions = {
  model?: string;
  gatewayId?: string;
  /** Marginal token pricing; intentionally adapter config because provider prices change independently from Core. */
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export class WorkersAiModelProvider implements ModelProvider {
  readonly model: string;
  readonly gatewayId: string;
  readonly inputPerMillionUsd: number | undefined;
  readonly outputPerMillionUsd: number | undefined;

  constructor(
    private readonly ai: WorkersAiBinding,
    options: WorkersAiModelProviderOptions = {},
  ) {
    // Strong enough for natural Spanish/tool planning while remaining available on Workers Free.
    this.model = options.model ?? DEFAULT_MODEL;
    this.gatewayId = options.gatewayId ?? "default";
    // Cloudflare Workers AI public pricing verified 2026-08-30 for the default model.
    // Custom models must supply their own rates to avoid silently stale estimates.
    this.inputPerMillionUsd = options.inputPerMillionUsd ?? (this.model === DEFAULT_MODEL ? 0.293 : undefined);
    this.outputPerMillionUsd = options.outputPerMillionUsd ?? (this.model === DEFAULT_MODEL ? 2.253 : undefined);
  }

  async completeStructured(request: StructuredModelRequest): Promise<StructuredModelResult> {
    const started = Date.now();
    try {
      const raw = await this.ai.run(
        this.model,
        {
          messages: request.messages,
          response_format: {
            type: "json_schema",
            json_schema: request.schema,
          },
          max_tokens: request.maxTokens ?? 320,
          temperature: request.temperature ?? 0.1,
        },
        {
          gateway: {
            id: this.gatewayId,
            skipCache: true,
            collectLog: true,
            ...(request.label ? { metadata: { label: request.label } } : {}),
          },
        },
      );

      if (!isRecord(raw) || !("response" in raw)) {
        throw new ModelProviderError("Workers AI returned an invalid structured response");
      }
      let value: unknown = raw.response;
      if (typeof value === "string") {
        try { value = JSON.parse(value) as unknown; }
        catch { throw new ModelProviderError("Workers AI returned non-JSON structured output"); }
      }

      const usage = isRecord(raw.usage) ? raw.usage : {};
      const inputTokens = numberField(usage.input_tokens) ?? numberField(usage.prompt_tokens);
      const outputTokens = numberField(usage.output_tokens) ?? numberField(usage.completion_tokens);
      const inputCost = inputTokens !== undefined && this.inputPerMillionUsd !== undefined
        ? (inputTokens / 1_000_000) * this.inputPerMillionUsd
        : undefined;
      const outputCost = outputTokens !== undefined && this.outputPerMillionUsd !== undefined
        ? (outputTokens / 1_000_000) * this.outputPerMillionUsd
        : undefined;
      const estimatedCostUsd = inputCost !== undefined || outputCost !== undefined
        ? (inputCost ?? 0) + (outputCost ?? 0)
        : undefined;
      return {
        value,
        model: this.model,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        latencyMs: Date.now() - started,
        ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
        ...(this.ai.aiGatewayLogId ? { logId: this.ai.aiGatewayLogId } : {}),
      };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      throw new ModelProviderError("Workers AI inference failed", error instanceof Error ? error.name : "UnknownError");
    }
  }
}
