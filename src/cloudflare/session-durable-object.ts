import { DurableObject } from "cloudflare:workers";
import type { SessionStore } from "../core/session.js";
import type { Session } from "../core/types.js";

const SESSION_KEY = "session";
const SESSION_URL = "https://session.internal/session";

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

function parseSessionJson(raw: string): Session {
  const value: unknown = JSON.parse(raw);
  if (!isSession(value)) throw new Error("Invalid stored session payload");
  return value;
}

/**
 * One Durable Object instance represents one opaque Agent Core session.
 * The object is reachable only through the Worker binding; this fetch handler
 * is an internal transport and does not create an Internet route.
 * SQLite synchronous KV stores canonical JSON to avoid cross-isolate
 * structured-clone differences at the session boundary.
 */
export class SessionDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/session") return new Response(null, { status: 404 });

    if (request.method === "GET") {
      const raw = this.ctx.storage.kv.get<string>(SESSION_KEY);
      if (raw === undefined) return new Response(null, { status: 404 });
      const session = parseSessionJson(raw);
      if (this.ctx.id.name && session.id !== this.ctx.id.name) {
        throw new Error("Session storage id does not match Durable Object name");
      }
      return new Response(raw, {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (request.method === "PUT") {
      const raw = await request.text();
      const session = parseSessionJson(raw);
      if (this.ctx.id.name && session.id !== this.ctx.id.name) {
        return new Response(null, { status: 409 });
      }
      this.ctx.storage.kv.put(SESSION_KEY, JSON.stringify(session));
      return new Response(null, { status: 204 });
    }

    return new Response(null, { status: 405 });
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
    return parseSessionJson(await response.text());
  }

  async put(session: Session): Promise<void> {
    if (!isSession(session)) throw new Error("Invalid session payload");
    const response = await this.namespace.getByName(session.id).fetch(new Request(SESSION_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session),
    }));
    if (!response.ok) throw new Error(`Session storage write failed (${response.status})`);
  }
}
