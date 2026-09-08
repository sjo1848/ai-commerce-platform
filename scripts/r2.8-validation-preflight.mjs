import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { completeTailEvents } from './r2.8-validation-turn-proof.mjs';

export function verifyAdmissionProbe(raw, { path, version }) {
  if (!path || !version) throw Error('probe path and exact version required');
  const matches = completeTailEvents(raw).filter(event => {
    try { const url = new URL(event.event?.request?.url); return url.pathname + url.search === path; } catch { return false; }
  });
  if (matches.length !== 1) throw Error('UNKNOWN: expected one completed admission probe');
  const event = matches[0];
  if (event.truncated !== false || event.outcome !== 'ok' || event.scriptVersion?.id !== version
    || event.event?.request?.method !== 'POST' || event.event?.response?.status !== 403) throw Error('invalid exact-version admission probe');
  if (!Array.isArray(event.logs) || !Array.isArray(event.exceptions) || event.logs.length || event.exceptions.length) throw Error('probe did not prove zero application/provider activity');
  return { version, path, status: 403, modelInferences: 0, reserves: 0, hmsOperations: 0, approvalConsumption: 0, completedEnvelope: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(verifyAdmissionProbe(readFileSync(process.argv[2], 'utf8'), { path: process.env.R28_PROBE_PATH, version: process.env.R28_VERSION_ID })));
}
