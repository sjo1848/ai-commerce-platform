import { CoreError } from "../core/errors.js";
import type { Actor } from "../core/types.js";
import type { AgentCoreRuntime } from "../core/runtime.js";

const HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AI Commerce Webchat</title></head>
<body><main><h1>Asistente</h1><form id="f"><input id="m" maxlength="2000" placeholder="Ej: disponibilidad 2026-09-10 a 2026-09-12 para 2 personas"><button>Enviar</button></form><pre id="o"></pre></main>
<script>let sessionId;document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();const message=document.getElementById('m').value;const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json','x-actor-id':'visitor-demo'},body:JSON.stringify({message,sessionId})});const j=await r.json();sessionId=j.sessionId||sessionId;document.getElementById('o').textContent=JSON.stringify(j,null,2)});</script></body></html>`;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export type WebchatHandlerConfig = {
  /** Trusted deployment configuration. When present, client tenant headers are ignored. */
  fixedTenantId?: string;
};

export function createWebchatHandler(runtime: AgentCoreRuntime, config: WebchatHandlerConfig = {}) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (request.method !== "POST" || url.pathname !== "/api/chat") return json({ error: { code: "NOT_FOUND" } }, 404);

    try {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) throw new CoreError("BAD_REQUEST", "JSON body required", 415);
      const body = await request.json() as Record<string, unknown>;
      const tenantId = config.fixedTenantId ?? request.headers.get("x-tenant-id") ?? "";
      const actorId = request.headers.get("x-actor-id")?.trim() || "anonymous";
      const actor: Actor = {
        id: actorId,
        type: "customer",
        roles: ["customer"],
        permissions: ["hms.availability.read", "hms.quote.read"],
      };
      const context = runtime.createContext({
        tenantId,
        actor,
        channel: "webchat",
        ...(typeof body.sessionId === "string" && body.sessionId ? { sessionId: body.sessionId } : {}),
        requestId: request.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      });
      const result = await runtime.orchestrator.chat(typeof body.message === "string" ? body.message : "", context);
      return json(result);
    } catch (error) {
      if (error instanceof CoreError) return json({ error: { code: error.code, message: error.message } }, error.status);
      return json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } }, 500);
    }
  };
}
