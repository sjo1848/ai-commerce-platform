import { DurableObject } from "cloudflare:workers";
import type { ConversationStore } from "../core/conversation.js";
import type { ReservationOperationBinding, ReservationOperationLookup, ReservationOperationStore } from "../core/reservation-operation-store.js";
import type { SessionStore } from "../core/session.js";
import type { ModelConversationTurn, Session, ToolPlan } from "../core/types.js";
import {
  approvalFingerprint,
  MAX_APPROVAL_RECOVERY_ATTEMPTS,
  type ApprovalChallenge,
  type ApprovalChallengeInput,
  type ApprovalChallengeIssueInput,
  type ApprovalConsumption,
  type ApprovalStore,
  type StoredApprovalChallenge,
} from "../webchat/approval.js";

const SESSION_KEY = "session";
const CONVERSATION_KEY = "conversation";
const SESSION_URL = "https://session.internal/session";
const CONVERSATION_URL = "https://session.internal/conversation";
const APPROVAL_URL = "https://session.internal/approval";
const APPROVAL_CONSUME_URL = "https://session.internal/approval/consume";
const RESERVATION_OPERATION_URL = "https://session.internal/reservation-operation";

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return typeof session.id === "string" && typeof session.tenantId === "string" && typeof session.actorId === "string" && typeof session.channel === "string" && typeof session.createdAt === "string" && typeof session.expiresAt === "string";
}
function parseSessionJson(raw: string): Session {
  const value: unknown = JSON.parse(raw);
  if (!isSession(value)) throw new Error("Invalid stored session payload");
  return value;
}
function isToolPlan(value: unknown): value is ToolPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.toolId === "string" && Boolean(plan.toolId.trim()) && Object.prototype.hasOwnProperty.call(plan, "input");
}
function isConversationTurn(value: unknown): value is ModelConversationTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Record<string, unknown>;
  return ["user", "assistant", "tool"].includes(String(turn.role))
    && typeof turn.content === "string"
    && turn.content.trim().length > 0
    && turn.content.length <= 4_000
    && (turn.toolId === undefined || typeof turn.toolId === "string");
}
function parseConversation(raw: string | undefined): ModelConversationTurn[] {
  if (raw === undefined) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every(isConversationTurn)) throw new Error("Invalid stored conversation payload");
  return value;
}
function isStoredApproval(value: unknown): value is StoredApprovalChallenge {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.token === "string" && item.token.length >= 16
    && typeof item.sessionId === "string"
    && typeof item.tenantId === "string"
    && typeof item.actorId === "string"
    && typeof item.fingerprint === "string" && /^[0-9a-f]{64}$/.test(item.fingerprint)
    && typeof item.operationFingerprint === "string" && /^[0-9a-f]{64}$/.test(item.operationFingerprint)
    && isToolPlan(item.plan)
    && Number.isInteger(item.recoveryAttempt) && Number(item.recoveryAttempt) >= 0 && Number(item.recoveryAttempt) <= MAX_APPROVAL_RECOVERY_ATTEMPTS
    && typeof item.expiresAt === "string" && Number.isFinite(Date.parse(item.expiresAt));
}
function parseStoredApproval(raw: string): StoredApprovalChallenge {
  const value: unknown = JSON.parse(raw);
  if (!isStoredApproval(value)) throw new Error("Invalid stored approval payload");
  return value;
}
function approvalKey(token: string): string { return `approval:${token}`; }
function reservationOperationKey(bookingId: string): string { return `reservation-operation:${bookingId}`; }
function isReservationOperationBinding(value: unknown): value is ReservationOperationBinding {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.sessionId === "string" && typeof item.tenantId === "string" && typeof item.actorId === "string" && typeof item.bookingId === "string" && typeof item.operationToken === "string" && item.operationToken.length >= 1;
}

/** Per-session durable authority for session, conversation, approval challenges and reversible reservation ownership. */
export class SessionDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env); }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/session") {
      if (request.method === "GET") {
        const raw = this.ctx.storage.kv.get<string>(SESSION_KEY);
        if (raw === undefined) return new Response(null, { status: 404 });
        const session = parseSessionJson(raw);
        if (this.ctx.id.name && session.id !== this.ctx.id.name) throw new Error("Session storage id does not match Durable Object name");
        return new Response(raw, { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
      }
      if (request.method === "PUT") {
        const raw = await request.text(); const session = parseSessionJson(raw);
        if (this.ctx.id.name && session.id !== this.ctx.id.name) return new Response(null, { status: 409 });
        this.ctx.storage.kv.put(SESSION_KEY, JSON.stringify(session));
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 405 });
    }

    if (url.pathname === "/conversation") {
      if (request.method === "GET") {
        const turns = parseConversation(this.ctx.storage.kv.get<string>(CONVERSATION_KEY));
        return new Response(JSON.stringify(turns), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
      }
      if (request.method === "POST") {
        const turn = await request.json() as unknown;
        if (!isConversationTurn(turn)) return new Response(null, { status: 400 });
        const turns = parseConversation(this.ctx.storage.kv.get<string>(CONVERSATION_KEY));
        turns.push({
          role: turn.role,
          content: turn.content.trim(),
          ...(turn.toolId ? { toolId: turn.toolId.slice(0, 200) } : {}),
        });
        if (turns.length > 32) turns.splice(0, turns.length - 32);
        this.ctx.storage.kv.put(CONVERSATION_KEY, JSON.stringify(turns));
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 405 });
    }

    if (url.pathname === "/approval" && request.method === "PUT") {
      const raw = await request.text(); const approval = parseStoredApproval(raw);
      if (this.ctx.id.name && approval.sessionId !== this.ctx.id.name) return new Response(null, { status: 409 });
      this.ctx.storage.kv.put(approvalKey(approval.token), JSON.stringify(approval));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/approval/consume" && request.method === "POST") {
      const candidate = await request.json() as Record<string, unknown>;
      const token = typeof candidate.token === "string" ? candidate.token : "";
      const tenantId = typeof candidate.tenantId === "string" ? candidate.tenantId : "";
      const actorId = typeof candidate.actorId === "string" ? candidate.actorId : "";
      const fingerprint = typeof candidate.fingerprint === "string" ? candidate.fingerprint : "";
      if (!token || !tenantId || !actorId || !/^[0-9a-f]{64}$/.test(fingerprint)) return new Response(null, { status: 400 });
      const key = approvalKey(token); const raw = this.ctx.storage.kv.get<string>(key);
      if (raw === undefined) return new Response(null, { status: 404 });
      const approval = parseStoredApproval(raw);
      if (Date.parse(approval.expiresAt) <= Date.now()) { this.ctx.storage.kv.delete(key); return new Response(null, { status: 410 }); }
      if (approval.tenantId !== tenantId || approval.actorId !== actorId || approval.fingerprint !== fingerprint) return new Response(null, { status: 409 });
      this.ctx.storage.kv.delete(key);
      return new Response(JSON.stringify({ operationFingerprint: approval.operationFingerprint, plan: approval.plan, recoveryAttempt: approval.recoveryAttempt }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    if (url.pathname === "/reservation-operation") {
      if (request.method === "PUT") {
        const binding = await request.json() as unknown;
        if (!isReservationOperationBinding(binding)) return new Response(null, { status: 400 });
        if (this.ctx.id.name && binding.sessionId !== this.ctx.id.name) return new Response(null, { status: 409 });
        const key = reservationOperationKey(binding.bookingId);
        const raw = this.ctx.storage.kv.get<string>(key);
        if (raw !== undefined) {
          const existing = JSON.parse(raw) as ReservationOperationBinding;
          if (existing.tenantId !== binding.tenantId || existing.actorId !== binding.actorId || existing.operationToken !== binding.operationToken) return new Response(null, { status: 409 });
          return new Response(null, { status: 204 });
        }
        this.ctx.storage.kv.put(key, JSON.stringify(binding));
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST") {
        const lookup = await request.json() as ReservationOperationLookup;
        if (!lookup || typeof lookup.sessionId !== "string" || typeof lookup.tenantId !== "string" || typeof lookup.actorId !== "string" || typeof lookup.bookingId !== "string") return new Response(null, { status: 400 });
        if (this.ctx.id.name && lookup.sessionId !== this.ctx.id.name) return new Response(null, { status: 409 });
        const raw = this.ctx.storage.kv.get<string>(reservationOperationKey(lookup.bookingId));
        if (raw === undefined) return new Response(null, { status: 404 });
        const binding = JSON.parse(raw) as ReservationOperationBinding;
        if (!isReservationOperationBinding(binding) || binding.tenantId !== lookup.tenantId || binding.actorId !== lookup.actorId) return new Response(null, { status: 403 });
        return new Response(JSON.stringify({ operationToken: binding.operationToken }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
      }
      return new Response(null, { status: 405 });
    }
    return new Response(null, { status: 404 });
  }
}

export class DurableObjectSessionStore implements SessionStore {
  constructor(private readonly namespace: DurableObjectNamespace<SessionDurableObject>) {}
  async get(id: string): Promise<Session | undefined> {
    const response = await this.namespace.getByName(id).fetch(SESSION_URL);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Session storage read failed (${response.status})`);
    return parseSessionJson(await response.text());
  }
  async put(session: Session): Promise<void> {
    if (!isSession(session)) throw new Error("Invalid session payload");
    const response = await this.namespace.getByName(session.id).fetch(new Request(SESSION_URL, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(session) }));
    if (!response.ok) throw new Error(`Session storage write failed (${response.status})`);
  }
}

export class DurableObjectConversationStore implements ConversationStore {
  public constructor(private readonly namespace: DurableObjectNamespace<SessionDurableObject>) {}
  async list(sessionId: string, limit = 12): Promise<ModelConversationTurn[]> {
    const response = await this.namespace.getByName(sessionId).fetch(CONVERSATION_URL);
    if (!response.ok) throw new Error(`Conversation storage read failed (${response.status})`);
    const turns = parseConversation(await response.text());
    return turns.slice(-Math.max(0, Math.min(limit, 32)));
  }
  async append(sessionId: string, turn: ModelConversationTurn): Promise<void> {
    if (!isConversationTurn(turn)) throw new Error("Invalid conversation turn");
    const response = await this.namespace.getByName(sessionId).fetch(new Request(CONVERSATION_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(turn) }));
    if (!response.ok) throw new Error(`Conversation storage write failed (${response.status})`);
  }
}

export class DurableObjectApprovalStore implements ApprovalStore {
  public constructor(private readonly namespace: DurableObjectNamespace<SessionDurableObject>, private readonly now: () => Date = () => new Date(), private readonly ttlMs = 5 * 60 * 1000) {}
  async issue(input: ApprovalChallengeIssueInput): Promise<ApprovalChallenge> {
    const recoveryAttempt = input.recoveryAttempt ?? 0;
    if (!Number.isInteger(recoveryAttempt) || recoveryAttempt < 0 || recoveryAttempt > MAX_APPROVAL_RECOVERY_ATTEMPTS) throw new Error("Invalid approval recovery attempt");
    const token = crypto.randomUUID(); const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    const stored: StoredApprovalChallenge = {
      token,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      fingerprint: await approvalFingerprint(input),
      operationFingerprint: input.operationFingerprint,
      plan: structuredClone(input.plan),
      recoveryAttempt,
      expiresAt,
    };
    const response = await this.namespace.getByName(input.sessionId).fetch(new Request(APPROVAL_URL, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(stored) }));
    if (!response.ok) throw new Error(`Approval storage write failed (${response.status})`);
    return { token, expiresAt };
  }
  async consume(input: ApprovalChallengeInput & { token: string }): Promise<ApprovalConsumption | null> {
    const response = await this.namespace.getByName(input.sessionId).fetch(new Request(APPROVAL_CONSUME_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: input.token, tenantId: input.tenantId, actorId: input.actorId, fingerprint: await approvalFingerprint(input) }) }));
    if ([404, 409, 410].includes(response.status)) return null;
    if (!response.ok) throw new Error(`Approval storage consume failed (${response.status})`);
    const payload = await response.json() as Record<string, unknown>;
    const operationFingerprint = typeof payload.operationFingerprint === "string" ? payload.operationFingerprint : "";
    const recoveryAttempt = Number(payload.recoveryAttempt);
    if (!/^[0-9a-f]{64}$/.test(operationFingerprint)) throw new Error("Approval storage returned an invalid operation fingerprint");
    if (!isToolPlan(payload.plan)) throw new Error("Approval storage returned an invalid tool plan");
    if (!Number.isInteger(recoveryAttempt) || recoveryAttempt < 0 || recoveryAttempt > MAX_APPROVAL_RECOVERY_ATTEMPTS) throw new Error("Approval storage returned an invalid recovery attempt");
    return { operationFingerprint, plan: payload.plan, recoveryAttempt };
  }
}

export class DurableObjectReservationOperationStore implements ReservationOperationStore {
  public constructor(private readonly namespace: DurableObjectNamespace<SessionDurableObject>) {}
  async bind(input: ReservationOperationBinding): Promise<void> {
    const response = await this.namespace.getByName(input.sessionId).fetch(new Request(RESERVATION_OPERATION_URL, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
    if (!response.ok) throw new Error(`Reservation ownership storage write failed (${response.status})`);
  }
  async get(input: ReservationOperationLookup): Promise<string | undefined> {
    const response = await this.namespace.getByName(input.sessionId).fetch(new Request(RESERVATION_OPERATION_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Reservation ownership storage read failed (${response.status})`);
    const payload = await response.json() as Record<string, unknown>;
    return typeof payload.operationToken === "string" && payload.operationToken ? payload.operationToken : undefined;
  }
}
