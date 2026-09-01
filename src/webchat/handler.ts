import { ApprovalRequiredError, CoreError } from "../core/errors.js";
import type { Actor, ToolExecutionMeta, ToolPlan } from "../core/types.js";
import type { AgentCoreRuntime } from "../core/runtime.js";
import type { ApprovalChallengeInput, ApprovalConsumption, ApprovalStore } from "./approval.js";

const HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AI Commerce Webchat</title></head>
<body><main><h1>Asistente</h1><form id="f"><input id="m" maxlength="2000" placeholder="Ej: somos dos y queremos quedarnos del 10 al 12 de febrero de 2034"><button>Enviar</button></form><pre id="o"></pre></main>
<script>let sessionId;document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();const message=document.getElementById('m').value;const operationKey=crypto.randomUUID();const send=async(path,approvalToken)=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':operationKey},body:JSON.stringify({message,sessionId,...(approvalToken?{approvalToken}:{})})});const j=await r.json();sessionId=j.sessionId||sessionId;if(path==='/api/chat'&&r.status===409&&j?.error?.code==='APPROVAL_REQUIRED'&&j?.approvalToken&&confirm(j.approvalSummary||'Esta acción modificará una reserva en HMS. ¿Confirmar?'))return send('/api/approve',j.approvalToken);if(path==='/api/approve'&&r.status===503&&j?.error?.code==='OUTCOME_UNKNOWN'&&j?.recoveryApprovalToken&&confirm('HMS no pudo confirmar el resultado. ¿Reintentar exactamente la misma operación?'))return send('/api/approve',j.recoveryApprovalToken);document.getElementById('o').textContent=JSON.stringify(j,null,2);};await send('/api/chat');});</script></body></html>`;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, 10)
    : [];
}

function approvalSummaryForPlan(plan: ToolPlan): string {
  const input = record(plan.input);
  if (plan.toolId === "hms.createMultiReservation") {
    const roomIds = stringList(input.roomIds);
    const checkIn = typeof input.checkIn === "string" ? input.checkIn : "?";
    const checkOut = typeof input.checkOut === "string" ? input.checkOut : "?";
    return `Confirmar reserva de ${roomIds.length} habitaciones (${roomIds.join(", ")}) del ${checkIn} al ${checkOut}.`;
  }
  if (plan.toolId === "hms.cancelMultiReservation") {
    const bookingIds = stringList(input.bookingIds);
    return `Confirmar cancelación de ${bookingIds.length} reservas (${bookingIds.join(", ")}).`;
  }
  if (plan.toolId === "hms.createReservation") {
    const roomId = typeof input.roomId === "string" ? input.roomId : "?";
    const checkIn = typeof input.checkIn === "string" ? input.checkIn : "?";
    const checkOut = typeof input.checkOut === "string" ? input.checkOut : "?";
    return `Confirmar reserva de la habitación ${roomId} del ${checkIn} al ${checkOut}.`;
  }
  if (plan.toolId === "hms.cancelReservation") {
    const bookingId = typeof input.bookingId === "string" ? input.bookingId : "?";
    return `Confirmar cancelación de la reserva ${bookingId}.`;
  }
  return "Esta acción modificará datos en HMS. ¿Confirmar?";
}

export type WebchatHandlerConfig = {
  /** Trusted deployment configuration. When present, client tenant headers are ignored. */
  fixedTenantId?: string;
  /** Pin a deployment actor when side effects must not trust a spoofable request header. */
  fixedActorId?: string;
  /** Server-side single-use approval challenges. Required for /api/approve. */
  approvalStore?: ApprovalStore;
};

export function createWebchatHandler(runtime: AgentCoreRuntime, config: WebchatHandlerConfig = {}) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    const approvalRoute = request.method === "POST" && url.pathname === "/api/approve";
    const chatRoute = request.method === "POST" && url.pathname === "/api/chat";
    if (!approvalRoute && !chatRoute) return json({ error: { code: "NOT_FOUND" } }, 404);

    const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
    let stage = "request";
    let activeSessionId: string | undefined;
    let approvalCandidate: ApprovalChallengeInput | undefined;
    let consumedApproval: ApprovalConsumption | undefined;

    try {
      stage = "parse_request";
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) throw new CoreError("BAD_REQUEST", "JSON body required", 415);
      const body = await request.json() as Record<string, unknown>;
      const message = typeof body.message === "string" ? body.message : "";
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
      if (approvalRoute && (typeof body.sessionId !== "string" || !body.sessionId.trim())) {
        throw new CoreError("BAD_REQUEST", "Approval requires an existing session", 400);
      }
      if (approvalRoute && (typeof body.approvalToken !== "string" || !body.approvalToken.trim())) {
        throw new CoreError("FORBIDDEN", "Approval challenge is required", 403);
      }
      if (approvalRoute && !idempotencyKey) {
        throw new CoreError("IDEMPOTENCY_REQUIRED", "Idempotency key required for approval", 400);
      }
      const tenantId = config.fixedTenantId ?? request.headers.get("x-tenant-id") ?? "";
      const actorId = config.fixedActorId ?? (request.headers.get("x-actor-id")?.trim() || "anonymous");
      const actor: Actor = {
        id: actorId,
        type: "customer",
        roles: ["customer"],
        permissions: [
          "hms.availability.read",
          "hms.quote.read",
          "hms.reservation.write",
          "hms.reservation.cancel",
        ],
      };
      const trustedMeta: ToolExecutionMeta = {
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };

      stage = "create_context";
      const context = await runtime.createContext({
        tenantId,
        actor,
        channel: "webchat",
        ...(typeof body.sessionId === "string" && body.sessionId ? { sessionId: body.sessionId } : {}),
        requestId,
      });
      activeSessionId = context.session.id;
      approvalCandidate = {
        sessionId: context.session.id,
        tenantId: context.tenant.id,
        actorId: context.actor.id,
        message,
        idempotencyKey,
      };

      if (approvalRoute) {
        stage = "consume_approval";
        if (!config.approvalStore) throw new CoreError("FORBIDDEN", "Approval flow is not enabled", 403);
        consumedApproval = await config.approvalStore.consume({
          ...approvalCandidate,
          token: (body.approvalToken as string).trim(),
        }) ?? undefined;
        if (!consumedApproval) throw new CoreError("FORBIDDEN", "Approval challenge is invalid or expired", 403);
        trustedMeta.humanApproved = true;
        trustedMeta.approvedOperationFingerprint = consumedApproval.operationFingerprint;
        stage = "execute_approved_plan";
        return json(await runtime.orchestrator.executeApprovedPlan(consumedApproval.plan, context, trustedMeta));
      }

      stage = "orchestrator";
      const result = await runtime.orchestrator.chat(message, context, trustedMeta);
      return json(result);
    } catch (error) {
      if (
        error instanceof ApprovalRequiredError
        && chatRoute
        && approvalCandidate
      ) {
        if (!approvalCandidate.idempotencyKey) {
          return json({
            error: { code: "IDEMPOTENCY_REQUIRED", message: "Idempotency key required for side-effect approval" },
            ...(activeSessionId ? { sessionId: activeSessionId } : {}),
          }, 400);
        }
        if (!config.approvalStore) {
          return json({
            error: { code: error.code, message: error.message },
            ...(activeSessionId ? { sessionId: activeSessionId } : {}),
          }, error.status);
        }
        try {
          stage = "issue_approval";
          const challenge = await config.approvalStore.issue({
            ...approvalCandidate,
            operationFingerprint: error.operationFingerprint,
            plan: error.plan,
          });
          return json({
            error: { code: error.code, message: error.message },
            sessionId: activeSessionId,
            approvalToken: challenge.token,
            approvalExpiresAt: challenge.expiresAt,
            approvalSummary: approvalSummaryForPlan(error.plan),
          }, error.status);
        } catch (approvalError) {
          console.error(JSON.stringify({
            event: "approval_challenge_issue_failed",
            requestId,
            errorName: approvalError instanceof Error ? approvalError.name : "UnknownError",
          }));
          return json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } }, 500);
        }
      }

      if (
        error instanceof CoreError
        && error.code === "OUTCOME_UNKNOWN"
        && approvalRoute
        && approvalCandidate
        && consumedApproval
        && config.approvalStore
      ) {
        try {
          stage = "issue_recovery_approval";
          const recovery = await config.approvalStore.issue({
            ...approvalCandidate,
            operationFingerprint: consumedApproval.operationFingerprint,
            plan: consumedApproval.plan,
          });
          return json({
            error: { code: error.code, message: error.message },
            sessionId: activeSessionId,
            recoveryApprovalToken: recovery.token,
            recoveryApprovalExpiresAt: recovery.expiresAt,
            approvalSummary: approvalSummaryForPlan(consumedApproval.plan),
          }, error.status);
        } catch (recoveryError) {
          console.error(JSON.stringify({
            event: "approval_recovery_issue_failed",
            requestId,
            errorName: recoveryError instanceof Error ? recoveryError.name : "UnknownError",
          }));
          return json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } }, 500);
        }
      }

      if (error instanceof CoreError) {
        return json({
          error: { code: error.code, message: error.message },
          ...(activeSessionId ? { sessionId: activeSessionId } : {}),
        }, error.status);
      }
      console.error(JSON.stringify({
        event: "webchat_unhandled_error",
        stage,
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : "unknown",
      }));
      return json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } }, 500);
    }
  };
}
