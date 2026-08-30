export type ApprovalChallengeInput = {
  sessionId: string;
  tenantId: string;
  actorId: string;
  message: string;
  idempotencyKey: string;
};

export type ApprovalChallenge = {
  token: string;
  expiresAt: string;
};

export type StoredApprovalChallenge = {
  token: string;
  sessionId: string;
  tenantId: string;
  actorId: string;
  fingerprint: string;
  expiresAt: string;
};

export interface ApprovalStore {
  issue(input: ApprovalChallengeInput): Promise<ApprovalChallenge>;
  consume(input: ApprovalChallengeInput & { token: string }): Promise<boolean>;
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

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly pending = new Map<string, StoredApprovalChallenge>();

  public constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  async issue(input: ApprovalChallengeInput): Promise<ApprovalChallenge> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    this.pending.set(token, {
      token,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      fingerprint: await approvalFingerprint(input),
      expiresAt,
    });
    return { token, expiresAt };
  }

  async consume(input: ApprovalChallengeInput & { token: string }): Promise<boolean> {
    const pending = this.pending.get(input.token);
    if (!pending) return false;
    if (Date.parse(pending.expiresAt) <= this.now().getTime()) {
      this.pending.delete(input.token);
      return false;
    }
    const matches = pending.sessionId === input.sessionId
      && pending.tenantId === input.tenantId
      && pending.actorId === input.actorId
      && pending.fingerprint === await approvalFingerprint(input);
    if (!matches) return false;
    this.pending.delete(input.token);
    return true;
  }
}
