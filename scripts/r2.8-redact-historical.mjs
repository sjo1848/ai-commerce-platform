import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { redactValidationTail } from './redact-validation-tail.mjs';
const secretKeys = new Set(['x-acp-validation-run-token', 'authorization', 'cookie', 'set-cookie']);
export function redactHistoricalEvidence(value) {
  if (Array.isArray(value)) return value.map(redactHistoricalEvidence);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, secretKeys.has(key.toLowerCase()) ? '[REDACTED]' : redactHistoricalEvidence(nested)]));
  if (typeof value === 'string') {
    try { return JSON.stringify(redactHistoricalEvidence(JSON.parse(value))); } catch { return redactValidationTail(value); }
  }
  return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const path of process.argv.slice(2)) {
    let raw; try { raw = readFileSync(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (raw.trim()) writeFileSync(path, JSON.stringify(redactHistoricalEvidence(JSON.parse(raw))));
  }
}
