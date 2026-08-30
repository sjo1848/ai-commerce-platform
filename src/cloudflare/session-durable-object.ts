import { DurableObject } from "cloudflare:workers";
import type { SessionStore } from "../core/session.js";
import type { Session } from "../core/types.js";

const SESSION_KEY = "session";
const SESSION_URL = "https://session.internal/session";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

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
 * The object is reachable only through the Worker binding; this fetch handler
 * is an internal transport and does not create an Internet route.
 */
export class SessionDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/session") return json({ error: "NOT_FOUND" }, 404);

    if (request.method === "GET") {
      const session = await this.ctx.storage.get<Session>(SESSION_KEY);
      return session ? json(session) : json({ error: "NOT_FOUND" }, 404);
    }

    if (request.method === "PUT") {
      const value: unknown = await request.json();
      if (!isSession(value)) return json({ error: "BAD_SESSION" }, 400);
      if (this.ctx.id.name && value.id !== this.ctx.id.name) {
        return json({ error: "SESSION_ID_MISMATCH" }, 409);
      }
      await this.ctx.storage.put(SESSION_KEY, value);
      return new Response(null, { status: 204 });
    }

    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }
}

export class DurableObjectSessionStore implements SessionStore {
  constructor(
    private readonly namespace: DurableObjectNamespace<SessionDurableObject>,
  ) {}

  async get(id: string): Promise<Session | undefined> {
    const response = await this.namespace.getByName(id).fetch(SESSION_URL);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Session storage read failed (${response.status})`);
    const value: unknown = await response.json();
    if (!isSession(value)) throw new Error("Session storage returned invalid data");
    return value;
  }

  async put(session: Session): Promise<void> {
    const response = await this.namespace.getByName(session.id).fetch(new Request(SESSION_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session),
    }));
    if (!response.ok) throw new Error(`Session storage write failed (${response.status})`);
  }
}
