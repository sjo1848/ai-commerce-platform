import { CoreError } from "./errors.js";
import type { Actor, Channel, Session, Tenant } from "./types.js";

export type SessionStore = {
  get(id: string): Session | undefined;
  put(session: Session): void;
};

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  get(id: string): Session | undefined { return this.sessions.get(id); }
  put(session: Session): void { this.sessions.set(session.id, session); }
}

export class SessionManager {
  constructor(private readonly store: SessionStore, private readonly ttlMs = 30 * 60 * 1000) {}

  getOrCreate(input: {
    sessionId?: string;
    tenant: Tenant;
    actor: Actor;
    channel: Channel;
    now: Date;
  }): Session {
    const { sessionId, tenant, actor, channel, now } = input;
    if (sessionId) {
      const current = this.store.get(sessionId);
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
    this.store.put(session);
    return session;
  }
}
