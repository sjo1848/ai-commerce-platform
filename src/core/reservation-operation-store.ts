export type ReservationOperationBinding = {
  sessionId: string;
  tenantId: string;
  actorId: string;
  bookingId: string;
  operationToken: string;
};

export type ReservationOperationLookup = Omit<ReservationOperationBinding, "operationToken">;

/**
 * Trusted server-side ownership mapping for reversible reservation cleanup.
 * The original create token never comes from model/user cancellation input.
 */
export interface ReservationOperationStore {
  bind(input: ReservationOperationBinding): Promise<void>;
  get(input: ReservationOperationLookup): Promise<string | undefined>;
}

export class InMemoryReservationOperationStore implements ReservationOperationStore {
  private readonly bindings = new Map<string, ReservationOperationBinding>();

  private key(input: ReservationOperationLookup): string {
    return `${input.sessionId}\u0000${input.tenantId}\u0000${input.actorId}\u0000${input.bookingId}`;
  }

  async bind(input: ReservationOperationBinding): Promise<void> {
    const key = this.key(input);
    const current = this.bindings.get(key);
    if (current && current.operationToken !== input.operationToken) {
      throw new Error("Reservation operation binding conflict");
    }
    this.bindings.set(key, structuredClone(input));
  }

  async get(input: ReservationOperationLookup): Promise<string | undefined> {
    return this.bindings.get(this.key(input))?.operationToken;
  }
}
