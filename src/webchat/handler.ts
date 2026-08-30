import { CoreError } from "../core/errors.js";
import type { Actor, ToolExecutionMeta } from "../core/types.js";
import type { AgentCoreRuntime } from "../core/runtime.js";

const HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AI Commerce Webchat</title></head>
<body><main><h1>Asistente</h1><form id="f"><input id="m" maxlength="2000" placeholder="Ej: disponibilidad 2027-02-10 a 2027-02-12 para 2 personas"><button>Enviar</button></form><pre id="o"></pre></main>
<script>let sessionId;document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();const message=document.getElementById('m').value;const operationKey=crypto.randomUUID();const send=async(path)=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':operationKey},body:JSON.stringify({message,sessionId})});const j=await r.json();sessionId=j.sessionId||sessionId;if(path==='/api/chat'&&r.status===409&&j?.error?.code==='APPROVAL_REQUIRED'&&confirm('Esta acción modificará una reserva en HMS. ¿Confirmar?'))return send('/api/approve');document.getElementById('o').textContent=JSON.stringify(j,null,2);};await send('/api/chat');});</script></body></html>`;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export type WebchatHandlerConfig = {
  /** Trusted deployment configuration. When present, client tenant headers are ignored. */
  fixedTenantId?: string;
  /** Pin a deployment actor when side effects must not trust a spoofable request header. */
  fixedActorId?: string;
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

    try {
      stage = "parse_request";
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) throw new CoreError("BAD_REQUEST", "JSON body required", 415);
      const body = await request.json() as Record<string, unknown>;
      if (approvalRoute && (typeof body.sessionId !== "string" || !body.sessionId.trim())) {
        throw new CoreError("BAD_REQUEST", "Approval requires an existing session", 400);
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
        ...(request.headers.get("idempotency-key")?.trim()
          ? { idempotencyKey: request.headers.get("idempotency-key")!.trim() }
          : {}),
        ...(approvalRoute ? { humanApproved: true } : {}),
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

      stage = "orchestrator";
      const result = await runtime.orchestrator.chat(
        typeof body.message === "string" ? body.message : "",
        context,
        trustedMeta,
      );
      return json(result);
    } catch (error) {
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
