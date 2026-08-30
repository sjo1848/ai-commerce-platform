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

export interface ApprovalStore {
  issue(input: ApprovalChallengeInput): Promise<ApprovalChallenge>;
  consume(input: ApprovalChallengeInput & { token: string }): Promise<boolean>;
}

type PendingApproval = ApprovalChallengeInput & ApprovalChallenge;

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly pending = new Map<string, PendingApproval>();

  public constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  async issue(input: ApprovalChallengeInput): Promise<ApprovalChallenge> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    this.pending.set(token, { ...structuredClone(input), token, expiresAt });
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
      && pending.message === input.message
      && pending.idempotencyKey === input.idempotencyKey;
    if (!matches) return false;
    this.pending.delete(input.token);
    return true;
  }
}
