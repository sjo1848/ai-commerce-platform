import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { completeTailEvents } from './r2.8-validation-turn-proof.mjs';
import { verifyRuntimeVersionDiagnostic } from './r2.8-runtime-version-diagnostic.mjs';

function verifyZeroActivity(event, version) {
  if (event.truncated !== false || event.outcome !== 'ok' || event.scriptVersion?.id !== version
    || event.event?.response?.status !== 403) throw Error('invalid exact-version admission event');
  if (!Array.isArray(event.logs) || !Array.isArray(event.exceptions) || event.exceptions.length) throw Error('event did not prove zero application/provider activity');
  // The outer boundary's one presence-only identity diagnostic is the sole
  // allowed log; no application, provider, HMS, or approval log may appear.
  if (event.logs.length > 1 || (event.logs.length === 1 && !JSON.stringify(event.logs[0]).includes('acp_validation_runtime_identity'))) throw Error('event did not prove zero application/provider activity');
}

export function verifyAdmissionProbe(raw, { path, version }) {
  if (!path || !version) throw Error('probe path and exact version required');
  const events = completeTailEvents(raw);
  const probes = events.filter(event => {
    try { const url = new URL(event.event?.request?.url); return url.pathname + url.search === path; } catch { return false; }
  });
  if (probes.length !== 1 || probes[0]?.event?.request?.method !== 'POST') throw Error('UNKNOWN: expected one completed admission POST probe');
  verifyZeroActivity(probes[0], version);
  return { version, path, status: 403, modelInferences: 0, reserves: 0, hmsOperations: 0, approvalConsumption: 0, completedEnvelope: true };
}

export function verifyLiveReadiness(raw, { version }) {
  if (!version) throw Error('exact version required');
  const roots = completeTailEvents(raw).filter(event => {
    try { const url = new URL(event.event?.request?.url); return url.pathname === '/' && url.search === '' && event.event?.request?.method === 'GET'; } catch { return false; }
  });
  if (roots.length !== 1) throw Error('UNKNOWN: expected one completed admission GET root evidence');
  verifyZeroActivity(roots[0], version);
  verifyRuntimeVersionDiagnostic(roots[0], { version });
  return { version, status: 403, rootRequests: 1, liveTailIdentity: true, modelInferences: 0, reserves: 0, hmsOperations: 0, approvalConsumption: 0, completedEnvelope: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = readFileSync(process.argv[2], 'utf8');
  console.log(JSON.stringify(process.env.R28_READINESS_ROOT_ONLY === 'true'
    ? verifyLiveReadiness(raw, { version: process.env.R28_VERSION_ID })
    : verifyAdmissionProbe(raw, { path: process.env.R28_PROBE_PATH, version: process.env.R28_VERSION_ID })));
}
