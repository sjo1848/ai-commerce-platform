import { ModelProviderError, type ModelProvider, type StructuredModelRequest, type StructuredModelResult } from "../core/model-provider.js";

export interface WorkersAiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
  readonly aiGatewayLogId?: string;
}

export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const R2_6_CANDIDATE_MODEL = "@cf/openai/gpt-oss-20b";
const DEFAULT_TIMEOUT_MS = 8_000;
const KNOWN_WORKERS_AI_ERROR_CODES = new Set(["3007", "3036", "3040"]);

export const WORKERS_AI_PRICING_USD_PER_MILLION: Readonly<Record<string, Readonly<{ input: number; output: number }>>> = {
  [DEFAULT_WORKERS_AI_MODEL]: { input: 0.293, output: 2.253 },
  [R2_6_CANDIDATE_MODEL]: { input: 0.200, output: 0.300 },
};

export type WorkersAiModelProviderOptions = {
  model?: string;
  gatewayId?: string;
  /** Marginal token pricing; intentionally adapter config because provider prices change independently from Core. */
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
  /** User-facing inference deadline. Timed-out calls fall back at the router/responder layer. */
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizedTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout < 250 || timeout > 30_000) {
    throw new Error("Workers AI timeout must be between 250ms and 30000ms");
  }
  return Math.floor(timeout);
}

function knownWorkersAiErrorCode(error: unknown): string | undefined {
  if (isRecord(error)) {
    for (const field of ["code", "internalCode", "errorCode"]) {
      const raw = error[field];
      const code = typeof raw === "number" && Number.isInteger(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : undefined;
      if (code && KNOWN_WORKERS_AI_ERROR_CODES.has(code)) return code;
    }
  }
  if (error instanceof Error) {
    const match = error.message.match(/\b(3007|3036|3040)\b/);
    if (match?.[1] && KNOWN_WORKERS_AI_ERROR_CODES.has(match[1])) return match[1];
  }
  return undefined;
}

function boundedErrorName(error: unknown): string {
  const knownCode = knownWorkersAiErrorCode(error);
  if (knownCode) return `CloudflareError${knownCode}`;
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(error.name)) return error.name;
  return "UnknownError";
}

export class WorkersAiModelProvider implements ModelProvider {
  readonly model: string;
  readonly gatewayId: string;
  readonly inputPerMillionUsd: number | undefined;
  readonly outputPerMillionUsd: number | undefined;
  readonly timeoutMs: number;
  /**
   * Automatic provider retries are intentionally zero. A timed-out inference may
   * still be running remotely, so retrying here can duplicate cost and worsen tail
   * latency. Safe deterministic fallback is the bounded recovery mechanism.
   */
  readonly maxRetries = 0;

  constructor(
    private readonly ai: WorkersAiBinding,
    options: WorkersAiModelProviderOptions = {},
  ) {
    this.model = options.model ?? DEFAULT_WORKERS_AI_MODEL;
    this.gatewayId = options.gatewayId ?? "default";
    this.timeoutMs = normalizedTimeout(options.timeoutMs);

    // Public Cloudflare Workers AI pricing snapshot verified for R2.6 on 2026-08-31/2026-09-01.
    // Unknown/custom models intentionally remain unpriced unless the caller supplies explicit rates.
    const catalogPricing = WORKERS_AI_PRICING_USD_PER_MILLION[this.model];
    this.inputPerMillionUsd = options.inputPerMillionUsd ?? catalogPricing?.input;
    this.outputPerMillionUsd = options.outputPerMillionUsd ?? catalogPricing?.output;
  }

  private async runBounded(request: StructuredModelRequest): Promise<unknown> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new ModelProviderError("Workers AI inference timed out", "TimeoutError")), this.timeoutMs);
    });
    try {
      return await Promise.race([
        this.ai.run(
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
        ),
        timeout,
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  async completeStructured(request: StructuredModelRequest): Promise<StructuredModelResult> {
    const started = Date.now();
    try {
      const raw = await this.runBounded(request);

      if (!isRecord(raw) || !("response" in raw)) {
        throw new ModelProviderError("Workers AI returned an invalid structured response", "InvalidStructuredResponse");
      }
      let value: unknown = raw.response;
      if (typeof value === "string") {
        try { value = JSON.parse(value) as unknown; }
        catch { throw new ModelProviderError("Workers AI returned non-JSON structured output", "NonJsonStructuredOutput"); }
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
      throw new ModelProviderError("Workers AI inference failed", boundedErrorName(error));
    }
  }
}
