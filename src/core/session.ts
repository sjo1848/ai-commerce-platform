import { CoreError } from "./errors.js";
import type { Actor, Channel, Session, Tenant } from "./types.js";

export type SessionStore = {
  get(id: string): Promise<Session | undefined>;
  put(session: Session): Promise<void>;
};

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  async get(id: string): Promise<Session | undefined> { return this.sessions.get(id); }
  async put(session: Session): Promise<void> { this.sessions.set(session.id, session); }
}

export class SessionManager {
  constructor(private readonly store: SessionStore, private readonly ttlMs = 30 * 60 * 1000) {}

  async getOrCreate(input: {
    sessionId?: string;
    tenant: Tenant;
    actor: Actor;
    channel: Channel;
    now: Date;
  }): Promise<Session> {
    const { sessionId, tenant, actor, channel, now } = input;
    if (sessionId) {
      const current = await this.store.get(sessionId);
      if (!current) throw new CoreError("BAD_REQUEST", "Unknown session", 400);
      if (current.tenantId !== tenant.id || current.actorId !== actor.id) {
        throw new CoreError("TENANT_MISMATCH", "Session context does not match tenant/actor", 403);
      }
      if (Date.parse(current.expiresAt) <= now.getTime()) {
        throw new CoreError("SESSION_EXPIRED", "Session expired", 401);
      }
      return current;
    }

    const createdAt = now.toISOString();
    const session: Session = {
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      actorId: actor.id,
      channel,
      createdAt,
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
    };
    await this.store.put(session);
    return session;
  }
}
