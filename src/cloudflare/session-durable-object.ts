import { DurableObject } from "cloudflare:workers";
import type { SessionStore } from "../core/session.js";
import type { Session } from "../core/types.js";

const SESSION_KEY = "session";

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return typeof session.id === "string"
    && typeof session.tenantId === "string"
    && typeof session.actorId === "string"
    && typeof session.channel === "string"
    && typeof session.createdAt === "string"
    && typeof session.expiresAt === "string";
}

/**
 * One Durable Object instance represents one opaque Agent Core session.
 * Public methods are invoked only through the namespace binding from the
 * Agent Core Worker; no Internet route is exposed for this object.
 */
export class SessionDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async getSession(): Promise<Session | undefined> {
    const value = await this.ctx.storage.get<unknown>(SESSION_KEY);
    if (value === undefined) return undefined;
    if (!isSession(value)) throw new Error("Session storage contains invalid data");
    if (this.ctx.id.name && value.id !== this.ctx.id.name) {
      throw new Error("Session storage id does not match Durable Object name");
    }
    return value;
  }

  async putSession(session: Session): Promise<void> {
    if (!isSession(session)) throw new Error("Invalid session payload");
    if (this.ctx.id.name && session.id !== this.ctx.id.name) {
      throw new Error("Session id does not match Durable Object name");
    }
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
