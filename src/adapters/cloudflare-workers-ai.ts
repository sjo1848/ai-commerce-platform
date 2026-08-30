import { ModelProviderError, type ModelProvider, type StructuredModelRequest, type StructuredModelResult } from "../core/model-provider.js";

export interface WorkersAiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
  readonly aiGatewayLogId?: string;
}

export type WorkersAiModelProviderOptions = {
  model?: string;
  gatewayId?: string;
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

  constructor(
    private readonly ai: WorkersAiBinding,
    options: WorkersAiModelProviderOptions = {},
  ) {
    // Strong enough for natural Spanish/tool planning while remaining available on Workers Free.
    this.model = options.model ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    this.gatewayId = options.gatewayId ?? "default";
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
      return {
        value,
        model: this.model,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        latencyMs: Date.now() - started,
        ...(this.ai.aiGatewayLogId ? { logId: this.ai.aiGatewayLogId } : {}),
      };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      throw new ModelProviderError("Workers AI inference failed", error instanceof Error ? error.name : "UnknownError");
    }
  }
}
