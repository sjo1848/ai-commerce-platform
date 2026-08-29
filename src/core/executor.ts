import { CoreError } from "./errors.js";
import type { AuditSink } from "./audit.js";
import type { IdempotencyStore } from "./idempotency.js";
import { stableStringify } from "./idempotency.js";
import type { PolicyEngine } from "./policy.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ExecutionContext, ToolExecutionMeta } from "./types.js";
import type { UsageSink } from "./usage.js";

export class AgentCoreExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: PolicyEngine,
    private readonly audit: AuditSink,
    private readonly usage: UsageSink,
    private readonly idempotency: IdempotencyStore,
  ) {}

  async execute(toolId: string, rawInput: unknown, context: ExecutionContext, meta: ToolExecutionMeta = {}): Promise<unknown> {
    const tool = this.registry.get(toolId);
    const policy = this.policy.evaluate(tool, context);
    const auditBase = {
      timestamp: context.now,
      requestId: context.requestId,
      tenantId: context.tenant.id,
      actorId: context.actor.id,
      sessionId: context.session.id,
      toolId,
    };

    if (policy.decision === "deny") {
      await this.audit.record({ ...auditBase, status: "denied", detail: policy.reason });
      throw new CoreError("TOOL_NOT_ALLOWED", "Tool execution denied", 403);
    }
    if (policy.decision === "approval_required") {
      await this.audit.record({ ...auditBase, status: "approval_required", detail: policy.reason });
      throw new CoreError("APPROVAL_REQUIRED", "Human approval is required", 409);
    }
    await this.audit.record({ ...auditBase, status: "allowed" });

    const validated = tool.validateInput(rawInput);
    if (!validated.ok) {
      await this.audit.record({ ...auditBase, status: "failed", detail: "input_validation" });
      throw new CoreError("BAD_REQUEST", validated.message, 400);
    }

    const hasSideEffect = tool.sideEffect !== "none";
    const fingerprint = stableStringify(validated.value);
    const rawKey = meta.idempotencyKey?.trim();
    const key = rawKey ? `${context.tenant.id}:${rawKey}` : undefined;
    if (hasSideEffect && !key) {
      await this.audit.record({ ...auditBase, status: "failed", detail: "idempotency_key_required" });
      throw new CoreError("IDEMPOTENCY_REQUIRED", "Idempotency key required for side-effect tool", 400);
    }

    if (hasSideEffect && key) {
      const existing = this.idempotency.get(key);
      if (existing) {
        if (
          existing.tenantId !== context.tenant.id ||
          existing.actorId !== context.actor.id ||
          existing.toolId !== toolId ||
          existing.fingerprint !== fingerprint
        ) {
          await this.audit.record({ ...auditBase, status: "failed", detail: "idempotency_conflict" });
          throw new CoreError("IDEMPOTENCY_CONFLICT", "Idempotency key was used for a different operation", 409);
        }
        await this.audit.record({ ...auditBase, status: "replayed" });
        return structuredClone(existing.result);
      }
    }

    await this.usage.record({
      timestamp: context.now,
      tenantId: context.tenant.id,
      sessionId: context.session.id,
      kind: "tool_call",
      units: 1,
      estimatedCostUsd: 0,
      label: toolId,
    });

    try {
      const result = await tool.execute(validated.value, context);
      if (hasSideEffect && key) {
        this.idempotency.put(key, {
          tenantId: context.tenant.id,
          actorId: context.actor.id,
          toolId,
          fingerprint,
          result,
        });
      }
      await this.audit.record({ ...auditBase, status: "succeeded" });
      return result;
    } catch (error) {
      await this.audit.record({ ...auditBase, status: "failed", detail: error instanceof Error ? error.message : "unknown" });
      if (error instanceof CoreError) throw error;
      throw new CoreError("TOOL_EXECUTION_FAILED", "Tool execution failed", 502);
    }
  }
}
