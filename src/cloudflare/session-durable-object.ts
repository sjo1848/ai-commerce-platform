import { DurableObject } from "cloudflare:workers";
import type { SessionStore } from "../core/session.js";
import type { Session } from "../core/types.js";
import {
  approvalFingerprint,
  type ApprovalChallenge,
  type ApprovalChallengeInput,
  type ApprovalStore,
  type StoredApprovalChallenge,
} from "../webchat/approval.js";

const SESSION_KEY = "session";
const SESSION_URL = "https://session.internal/session";
const APPROVAL_URL = "https://session.internal/approval";
const APPROVAL_CONSUME_URL = "https://session.internal/approval/consume";

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

function isStoredApproval(value: unknown): value is StoredApprovalChallenge {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.token === "string"
    && item.token.length >= 16
    && typeof item.sessionId === "string"
    && typeof item.tenantId === "string"
    && typeof item.actorId === "string"
    && typeof item.fingerprint === "string"
    && /^[0-9a-f]{64}$/.test(item.fingerprint)
    && typeof item.expiresAt === "string"
    && Number.isFinite(Date.parse(item.expiresAt));
}

function parseStoredApproval(raw: string): StoredApprovalChallenge {
  const value: unknown = JSON.parse(raw);
  if (!isStoredApproval(value)) throw new Error("Invalid stored approval payload");
  return value;
}

function approvalKey(token: string): string {
  return `approval:${token}`;
}

/**
 * One Durable Object instance represents one opaque Agent Core session.
 * The object is reachable only through the Worker binding; these fetch handlers
 * are internal transports and do not create Internet routes.
 * SQLite synchronous KV stores canonical JSON to avoid cross-isolate
 * structured-clone differences at the session boundary.
 *
 * Approval challenges live in the same per-session object. Consume is
 * serialized by the Durable Object, making a challenge single-use even when
 * two approval requests race.
 */
export class SessionDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/session") {
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

    if (url.pathname === "/approval" && request.method === "PUT") {
      const raw = await request.text();
      const approval = parseStoredApproval(raw);
      if (this.ctx.id.name && approval.sessionId !== this.ctx.id.name) {
        return new Response(null, { status: 409 });
      }
      this.ctx.storage.kv.put(approvalKey(approval.token), JSON.stringify(approval));
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/approval/consume" && request.method === "POST") {
      const candidate = await request.json() as Record<string, unknown>;
      const token = typeof candidate.token === "string" ? candidate.token : "";
      const tenantId = typeof candidate.tenantId === "string" ? candidate.tenantId : "";
      const actorId = typeof candidate.actorId === "string" ? candidate.actorId : "";
      const fingerprint = typeof candidate.fingerprint === "string" ? candidate.fingerprint : "";
      if (!token || !tenantId || !actorId || !/^[0-9a-f]{64}$/.test(fingerprint)) {
        return new Response(null, { status: 400 });
      }

      const key = approvalKey(token);
      const raw = this.ctx.storage.kv.get<string>(key);
      if (raw === undefined) return new Response(null, { status: 404 });
      const approval = parseStoredApproval(raw);
      if (Date.parse(approval.expiresAt) <= Date.now()) {
        this.ctx.storage.kv.delete(key);
        return new Response(null, { status: 410 });
      }
      if (
        approval.tenantId !== tenantId
        || approval.actorId !== actorId
        || approval.fingerprint !== fingerprint
      ) {
        return new Response(null, { status: 409 });
      }

      this.ctx.storage.kv.delete(key);
      return new Response(null, { status: 204 });
    }

    return new Response(null, { status: 404 });
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

export class DurableObjectApprovalStore implements ApprovalStore {
  public constructor(
    private readonly namespace: DurableObjectNamespace<SessionDurableObject>,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  async issue(input: ApprovalChallengeInput): Promise<ApprovalChallenge> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    const stored: StoredApprovalChallenge = {
      token,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      fingerprint: await approvalFingerprint(input),
      expiresAt,
    };
    const response = await this.namespace.getByName(input.sessionId).fetch(new Request(APPROVAL_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stored),
    }));
    if (!response.ok) throw new Error(`Approval storage write failed (${response.status})`);
    return { token, expiresAt };
  }

  async consume(input: ApprovalChallengeInput & { token: string }): Promise<boolean> {
    const response = await this.namespace.getByName(input.sessionId).fetch(new Request(APPROVAL_CONSUME_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: input.token,
        tenantId: input.tenantId,
        actorId: input.actorId,
        fingerprint: await approvalFingerprint(input),
      }),
    }));
    if (response.status === 204) return true;
    if ([404, 409, 410].includes(response.status)) return false;
    throw new Error(`Approval storage consume failed (${response.status})`);
  }
}
