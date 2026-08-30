import { DurableObject } from "cloudflare:workers";
import type { SessionStore } from "../core/session.js";
import type { Session } from "../core/types.js";

const SESSION_KEY = "session";

/**
 * One Durable Object instance represents one opaque Agent Core session.
 * SQLite-backed Durable Object storage survives isolate eviction/restarts.
 */
export class SessionDurableObject extends DurableObject {
  async getSession(): Promise<Session | undefined> {
    return this.ctx.storage.get<Session>(SESSION_KEY);
  }

  async putSession(session: Session): Promise<void> {
    await this.ctx.storage.put(SESSION_KEY, session);
  }
}

export class DurableObjectSessionStore implements SessionStore {
  constructor(
    private readonly namespace: DurableObjectNamespace<SessionDurableObject>,
  ) {}

  async get(id: string): Promise<Session | undefined> {
    return this.namespace.getByName(id).getSession();
  }

  async put(session: Session): Promise<void> {
    await this.namespace.getByName(session.id).putSession(session);
  }
}
