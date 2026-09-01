import { ApprovalRequiredError, CoreError } from "./errors.js";
import type { AuditSink } from "./audit.js";
import type { IdempotencyStore } from "./idempotency.js";
import { stableStringify } from "./idempotency.js";
import { operationFingerprint } from "./operation-fingerprint.js";
import type { PolicyEngine } from "./policy.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ExecutionContext, ToolExecutionMeta } from "./types.js";
import type { UsageSink } from "./usage.js";

function isAuthoritativeDownstreamReplay(result: unknown): boolean {
  return result !== null && typeof result === "object" && (result as Record<string, unknown>).replayed === true;
}

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
    const auditBase = { timestamp: context.now, requestId: context.requestId, tenantId: context.tenant.id, actorId: context.actor.id, sessionId: context.session.id, toolId };

    if (policy.decision === "deny") {
      await this.audit.record({ ...auditBase, status: "denied", detail: policy.reason });
      throw new CoreError("TOOL_NOT_ALLOWED", "Tool execution denied", 403);
    }

    // Canonicalization may add trusted server-owned bindings that are absent from model-visible input.
    const validated = tool.validateInput(rawInput, context);
    if (!validated.ok) {
      await this.audit.record({ ...auditBase, status: "failed", detail: "input_validation" });
      throw new CoreError("BAD_REQUEST", validated.message, 400);
    }

    if (policy.decision === "approval_required") {
      const plannedOperationFingerprint = await operationFingerprint(toolId, validated.value);
      if (!meta.humanApproved) {
        await this.audit.record({ ...auditBase, status: "approval_required", detail: policy.reason });
        throw new ApprovalRequiredError(plannedOperationFingerprint, { toolId, input: validated.value });
      }
      if (meta.approvedOperationFingerprint !== plannedOperationFingerprint) {
        await this.audit.record({ ...auditBase, status: "denied", detail: "approval_operation_mismatch" });
        throw new CoreError("FORBIDDEN", "Approval does not match requested operation", 403);
      }
      await this.audit.record({ ...auditBase, status: "allowed", detail: `human_approval_confirmed:${policy.reason}` });
    } else {
      await this.audit.record({ ...auditBase, status: "allowed" });
    }

    const hasSideEffect = tool.sideEffect !== "none";
    const coreIdempotency = hasSideEffect && tool.idempotencyMode !== "downstream";
    const fingerprint = stableStringify(validated.value);
    const rawKey = meta.idempotencyKey?.trim();
    const key = rawKey ? `${context.tenant.id}:${rawKey}` : undefined;
    if (hasSideEffect && !key) {
      await this.audit.record({ ...auditBase, status: "failed", detail: "idempotency_key_required" });
      throw new CoreError("IDEMPOTENCY_REQUIRED", "Idempotency key required for side-effect tool", 400);
    }

    if (coreIdempotency && key) {
      const existing = this.idempotency.get(key);
      if (existing) {
        if (
          existing.tenantId !== context.tenant.id
          || existing.actorId !== context.actor.id
          || existing.sessionId !== context.session.id
          || existing.toolId !== toolId
          || existing.fingerprint !== fingerprint
        ) {
          await this.audit.record({ ...auditBase, status: "failed", detail: "idempotency_conflict" });
          throw new CoreError("IDEMPOTENCY_CONFLICT", "Idempotency key was used for a different operation", 409);
        }
        await this.audit.record({ ...auditBase, status: "replayed" });
        return structuredClone(existing.result);
      }
    }

    await this.usage.record({ timestamp: context.now, tenantId: context.tenant.id, sessionId: context.session.id, kind: "tool_call", units: 1, estimatedCostUsd: 0, label: toolId });

    try {
      const result = await tool.execute(validated.value, context, meta);
      if (coreIdempotency && key) {
        this.idempotency.put(key, {
          tenantId: context.tenant.id,
          actorId: context.actor.id,
          sessionId: context.session.id,
          toolId,
          fingerprint,
          result,
        });
      }
      const downstreamReplay = tool.idempotencyMode === "downstream" && isAuthoritativeDownstreamReplay(result);
      await this.audit.record({ ...auditBase, status: downstreamReplay ? "replayed" : "succeeded", ...(downstreamReplay ? { detail: "downstream_authoritative_replay" } : {}) });
      return result;
    } catch (error) {
      await this.audit.record({ ...auditBase, status: "failed", detail: error instanceof Error ? error.message : "unknown" });
      if (error instanceof CoreError) throw error;
      throw new CoreError("TOOL_EXECUTION_FAILED", "Tool execution failed", 502);
    }
  }
}