import type { ToolPlan } from "../core/types.js";

export const MAX_APPROVAL_RECOVERY_ATTEMPTS = 3;

export type ApprovalChallengeInput = {
  sessionId: string;
  tenantId: string;
  actorId: string;
  message: string;
  idempotencyKey: string;
};

export type ApprovalChallengeIssueInput = ApprovalChallengeInput & {
  operationFingerprint: string;
  plan: ToolPlan;
  /** Server-owned recovery depth. Never derived from request/body input. */
  recoveryAttempt?: number;
};

export type ApprovalChallenge = {
  token: string;
  expiresAt: string;
};

export type ApprovalConsumption = {
  operationFingerprint: string;
  plan: ToolPlan;
  recoveryAttempt: number;
};

export type StoredApprovalChallenge = {
  token: string;
  sessionId: string;
  tenantId: string;
  actorId: string;
  fingerprint: string;
  operationFingerprint: string;
  plan: ToolPlan;
  recoveryAttempt: number;
  expiresAt: string;
};

export interface ApprovalStore {
  issue(input: ApprovalChallengeIssueInput): Promise<ApprovalChallenge>;
  consume(input: ApprovalChallengeInput & { token: string }): Promise<ApprovalConsumption | null>;
}

export async function approvalFingerprint(input: ApprovalChallengeInput): Promise<string> {
  const canonical = JSON.stringify({
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    message: input.message.trim(),
    idempotencyKey: input.idempotencyKey,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validOperationFingerprint(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function validPlan(plan: ToolPlan): boolean {
  return Boolean(plan && typeof plan.toolId === "string" && plan.toolId.trim() && Object.prototype.hasOwnProperty.call(plan, "input"));
}

function normalizedRecoveryAttempt(value: number | undefined): number {
  const attempt = value ?? 0;
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > MAX_APPROVAL_RECOVERY_ATTEMPTS) {
    throw new Error("Invalid approval recovery attempt");
  }
  return attempt;
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly pending = new Map<string, StoredApprovalChallenge>();

  public constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  async issue(input: ApprovalChallengeIssueInput): Promise<ApprovalChallenge> {
    if (!validOperationFingerprint(input.operationFingerprint)) throw new Error("Invalid approval operation fingerprint");
    if (!validPlan(input.plan)) throw new Error("Invalid approval plan");
    const recoveryAttempt = normalizedRecoveryAttempt(input.recoveryAttempt);
    const token = crypto.randomUUID();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    this.pending.set(token, {
      token,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      fingerprint: await approvalFingerprint(input),
      operationFingerprint: input.operationFingerprint,
      plan: structuredClone(input.plan),
      recoveryAttempt,
      expiresAt,
    });
    return { token, expiresAt };
  }

  async consume(input: ApprovalChallengeInput & { token: string }): Promise<ApprovalConsumption | null> {
    const pending = this.pending.get(input.token);
    if (!pending) return null;
    if (Date.parse(pending.expiresAt) <= this.now().getTime()) {
      this.pending.delete(input.token);
      return null;
    }
    const matches = pending.sessionId === input.sessionId
      && pending.tenantId === input.tenantId
      && pending.actorId === input.actorId
      && pending.fingerprint === await approvalFingerprint(input);
    if (!matches) return null;
    this.pending.delete(input.token);
    return {
      operationFingerprint: pending.operationFingerprint,
      plan: structuredClone(pending.plan),
      recoveryAttempt: pending.recoveryAttempt,
    };
  }
}
