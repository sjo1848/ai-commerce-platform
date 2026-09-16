import { operationFingerprint } from "./operation-fingerprint.js";
import type { PolicyDecision, PolicyEngine } from "./policy.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ExecutionContext, IdempotencyMode, SideEffect } from "./types.js";

type RejectedAdmissionSurface = {
  canonicalInput?: never;
  sideEffect?: never;
  idempotencyMode?: never;
  operationFingerprint?: never;
};

export type CoreToolAdmissionResult =
  | {
      decision: "allow";
      toolId: string;
      canonicalInput: unknown;
      sideEffect: SideEffect;
      idempotencyMode?: IdempotencyMode;
      operationFingerprint?: string;
    }
  | {
      decision: "approval_required";
      toolId: string;
      canonicalInput: unknown;
      sideEffect: SideEffect;
      idempotencyMode?: IdempotencyMode;
      operationFingerprint: string;
      reason: "approval_required";
    }
  | ({
      decision: "deny";
      toolId: string;
      reason: string;
    } & RejectedAdmissionSurface)
  | ({
      decision: "invalid_input";
      toolId: string;
      message: string;
    } & RejectedAdmissionSurface);

/**
 * Side-effect-free Core admission. It deliberately reuses the authoritative
 * ToolRegistry, PolicyEngine, tool.validateInput canonicalization and operation
 * fingerprint implementation. It never executes a tool and never consumes an
 * approval. The legacy AgentCoreExecutor remains unchanged and authoritative
 * for actual execution/idempotency/audit.
 */
export class CoreToolAdmission {
  public constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: PolicyEngine,
  ) {}

  public async admit(toolId: string, rawInput: unknown, context: ExecutionContext): Promise<CoreToolAdmissionResult> {
    const tool = this.registry.get(toolId);
    const policy: PolicyDecision = this.policy.evaluate(tool, context);
    if (policy.decision === "deny") return { decision: "deny", toolId, reason: policy.reason };

    const validated = tool.validateInput(rawInput, context);
    if (!validated.ok) return { decision: "invalid_input", toolId, message: validated.message };

    const needsOperationFingerprint = policy.decision === "approval_required" || tool.sideEffect !== "none";
    const fingerprint = needsOperationFingerprint
      ? await operationFingerprint(toolId, validated.value)
      : undefined;

    if (policy.decision === "approval_required") {
      if (!fingerprint) throw new Error("Approval admission requires an operation fingerprint");
      return {
        decision: "approval_required",
        toolId,
        canonicalInput: structuredClone(validated.value),
        sideEffect: tool.sideEffect,
        ...(tool.idempotencyMode ? { idempotencyMode: tool.idempotencyMode } : {}),
        operationFingerprint: fingerprint,
        reason: "approval_required",
      };
    }

    return {
      decision: "allow",
      toolId,
      canonicalInput: structuredClone(validated.value),
      sideEffect: tool.sideEffect,
      ...(tool.idempotencyMode ? { idempotencyMode: tool.idempotencyMode } : {}),
      ...(fingerprint ? { operationFingerprint: fingerprint } : {}),
    };
  }
}
