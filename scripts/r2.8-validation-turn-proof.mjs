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
    else if (c === '}' && --depth === 0) {
      try { events.push(JSON.parse(raw.slice(start, i + 1))); }
      catch { throw Error('CAPTURED_INVALID: malformed tail event'); }
      start = -1;
    }
  }
  if (start >= 0) throw Error('CAPTURED_INVALID: incomplete tail event');
  return events;
}
export function telemetry(value, found = []) {
  if (Array.isArray(value)) value.forEach(x => telemetry(x, found));
  else if (value && typeof value === 'object') { if (value.kind) found.push(value); Object.values(value).forEach(x => telemetry(x, found)); }
  else if (typeof value === 'string') {
    const text = value.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return found;
    try { telemetry(JSON.parse(text), found); }
    catch { throw Error('CAPTURED_INVALID: malformed captured telemetry JSON'); }
  }
  return found;
}
export async function proveValidationTurn(requestId, sessionId, { path = process.env.R28_TAIL_PATH, timeoutMs = 15000 } = {}) {
  if (!path) throw Error('UNKNOWN: R28_TAIL_PATH unavailable for per-turn route proof');
  const deadline = Date.now() + timeoutMs;
  do {
    let raw;
    try { raw = readFileSync(path, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw Error('UNKNOWN: R28 tail path unavailable for per-turn route proof');
      throw Error(`CAPTURED_INVALID: unable to read R28 tail capture${error?.code ? ` (${error.code})` : ''}`);
    }
    const events = completeTailEvents(raw);
    const event = events.find(value => Object.entries(value.event?.request?.headers ?? {}).some(([key, value]) => key.toLowerCase() === 'x-request-id' && value === requestId));
    if (event) {
      if (event.truncated !== false || event.outcome !== "ok") throw Error("incomplete or failed tail envelope");
      if (process.env.R28_VERSION_ID && event.scriptVersion?.id !== process.env.R28_VERSION_ID) throw Error("turn Worker Version mismatch");
      const logs = telemetry(event);
      const routes = logs.filter(x => x.sessionId === sessionId && x.label === 'agent_core_route');
      if (routes.some(x => x.kind === 'model_fallback')) throw Error('contractual route fallback');
      // A completed Worker envelope without route telemetry is an observability
      // gap, not evidence that the model did not run. The direct functional
      // predicates remain authoritative; do not manufacture a zero here.
      if (!routes.some(x => x.kind === 'model_inference' && x.model === '@cf/meta/llama-3.3-70b-instruct-fp8-fast')) throw Error('UNKNOWN: completed request has no captured baseline route inference');
      const audits = logs.filter(x => x.kind === 'audit_event' && x.sessionId === sessionId);
      if (audits.some(x => ['succeeded', 'replayed'].includes(x.status) && /create|cancel|approve/i.test(String(x.toolId)))) throw Error('unauthorized mutation or approval activity');
      return { requestId, sessionId, routeFallbacks: 0, completedTailEvent: true };
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw Error('UNKNOWN: missing completed request-correlated route telemetry');
}
