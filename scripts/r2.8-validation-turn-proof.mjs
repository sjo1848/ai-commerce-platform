import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

// Wrangler emits concatenated, pretty-printed event objects with PTY metadata.
export function completeTailEvents(raw) {
  const events = []; let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (start < 0) { if (c === '{') { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { events.push(JSON.parse(raw.slice(start, i + 1))); } catch {} start = -1; }
  }
  return events;
}
function telemetry(value, found = []) {
  if (Array.isArray(value)) value.forEach(x => telemetry(x, found));
  else if (value && typeof value === 'object') { if (value.kind) found.push(value); Object.values(value).forEach(x => telemetry(x, found)); }
  else if (typeof value === 'string') { try { telemetry(JSON.parse(value), found); } catch {} }
  return found;
}
export async function proveValidationTurn(requestId, sessionId, { path = process.env.R28_TAIL_PATH, timeoutMs = 15000 } = {}) {
  if (!path) throw Error('R28_TAIL_PATH required: per-turn route proof is fail-closed');
  const deadline = Date.now() + timeoutMs;
  do {
    let events = []; try { events = completeTailEvents(readFileSync(path, 'utf8')); } catch {}
    const event = events.find(value => Object.entries(value.event?.request?.headers ?? {}).some(([key, value]) => key.toLowerCase() === 'x-request-id' && value === requestId));
    if (event) {
      if (event.truncated !== false || event.outcome !== "ok") throw Error("incomplete or failed tail envelope");
      if (process.env.R28_VERSION_ID && event.scriptVersion?.id !== process.env.R28_VERSION_ID) throw Error("turn Worker Version mismatch");
      const logs = telemetry(event);
      const routes = logs.filter(x => x.sessionId === sessionId && x.label === 'agent_core_route');
      if (routes.some(x => x.kind === 'model_fallback')) throw Error('contractual route fallback');
      if (!routes.some(x => x.kind === 'model_inference' && x.model === '@cf/meta/llama-3.3-70b-instruct-fp8-fast')) throw Error('completed request has no baseline route inference');
      const audits = logs.filter(x => x.kind === 'audit_event' && x.sessionId === sessionId);
      if (audits.some(x => ['succeeded', 'replayed'].includes(x.status) && /create|cancel|approve/i.test(String(x.toolId)))) throw Error('unauthorized mutation or approval activity');
      return { requestId, sessionId, routeFallbacks: 0, completedTailEvent: true };
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw Error('UNKNOWN: missing completed request-correlated route telemetry');
}
