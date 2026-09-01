import type { StructuredModelResult } from "./model-provider.js";
import type { ExecutionContext } from "./types.js";
import type { UsageSink } from "./usage.js";

function boundedFailureCategory(value: string | undefined): string | undefined {
  if (!value || !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value)) return undefined;
  return value;
}

export async function recordModelInference(
  usage: UsageSink | undefined,
  context: ExecutionContext,
  label: string,
  result: StructuredModelResult,
): Promise<void> {
  if (!usage) return;
  await usage.record({
    timestamp: context.now,
    tenantId: context.tenant.id,
    sessionId: context.session.id,
    kind: "model_inference",
    units: 1,
    estimatedCostUsd: result.estimatedCostUsd ?? 0,
    label,
    ...(result.model ? { model: result.model } : {}),
    ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
    ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
    ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
    ...(result.logId ? { logId: result.logId } : {}),
  });
}

export async function recordModelFallback(
  usage: UsageSink | undefined,
  context: ExecutionContext,
  label: string,
  reason: string,
  failureCategory?: string,
): Promise<void> {
  if (!usage) return;
  const bounded = boundedFailureCategory(failureCategory);
  await usage.record({
    timestamp: context.now,
    tenantId: context.tenant.id,
    sessionId: context.session.id,
    kind: "model_fallback",
    units: 1,
    estimatedCostUsd: 0,
    label,
    fallbackReason: reason,
    ...(bounded ? { failureCategory: bounded } : {}),
  });
}
