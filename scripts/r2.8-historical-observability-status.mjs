import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Historical Workers Observability is supplemental to the live, exact-version
// admission proof. Its absence cannot establish zero provider consumption.
export function classifyHistoricalObservability({ exitCode = 0, raw = "" } = {}) {
  if (exitCode !== 0) return { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: false };
  try {
    const payload = JSON.parse(raw);
    if (payload?.success !== true) return { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: false };
    const events = Array.isArray(payload.result) ? payload.result : payload.result?.events;
    if (!Array.isArray(events) || events.length === 0) {
      return { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: true };
    }
    return { classification: "HISTORICAL_VISIBLE_SUPPLEMENTAL", querySucceeded: true, eventCount: events.length };
  } catch {
    return { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: false };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  let raw = "";
  try { raw = path ? readFileSync(path, "utf8") : ""; } catch { /* absence is unknown, never zero */ }
  console.log(JSON.stringify(classifyHistoricalObservability({ exitCode: Number(process.env.R28_HISTORICAL_QUERY_EXIT ?? 0), raw })));
}
