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

const budgetFields = [
  "experimentId", "updatedAt", "status", "configuredMaxNeurons", "configuredReserve",
  "observedProviderNeurons", "inferenceCount", "activeReservationCount", "totalReservedAllowance",
];

function collectBudgetEvents(value, workerEvent, found = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectBudgetEvents(item, workerEvent, found));
    return found;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return found;
    try { collectBudgetEvents(JSON.parse(text), workerEvent, found); } catch { /* malformed records are handled by the caller */ }
    return found;
  }
  if (!value || typeof value !== "object") return found;
  const outer = value?.$workers?.event ?? workerEvent;
  if (value.event === "agent_core_experiment_budget") found.push({ record: value, workerEvent: outer });
  Object.values(value).forEach((item) => collectBudgetEvents(item, outer, found));
  return found;
}

function validBudgetRecord(record) {
  return budgetFields.every((field) => Object.prototype.hasOwnProperty.call(record, field))
    && typeof record.experimentId === "string" && record.experimentId.length > 0
    && typeof record.updatedAt === "string" && Number.isFinite(Date.parse(record.updatedAt))
    && ["ACTIVE", "BUDGET_EXHAUSTED", "COMPLETE"].includes(record.status)
    && Number.isFinite(record.configuredMaxNeurons) && record.configuredMaxNeurons >= 0
    && Number.isFinite(record.configuredReserve) && record.configuredReserve >= 0
    && record.configuredReserve <= record.configuredMaxNeurons
    && Number.isFinite(record.observedProviderNeurons) && record.observedProviderNeurons >= 0
    && Number.isInteger(record.inferenceCount) && record.inferenceCount >= 0
    && Number.isInteger(record.activeReservationCount) && record.activeReservationCount >= 0
    && Number.isFinite(record.totalReservedAllowance) && record.totalReservedAllowance >= 0;
}

/**
 * The durable budget snapshot is the one required historical-evidence
 * exception. It must be correlated to the current experiment and immutable
 * Worker Version; missing, malformed, stale or unreconciled data fails closed.
 */
export function classifyDurableBudgetReconciliation({ exitCode = 0, raw = "", experimentId = "", workerVersionId = "", expectedConfiguredMaxNeurons = 7000, expectedConfiguredReserve = 0 } = {}) {
  const fail = (reason) => ({ classification: "BUDGET_RECONCILIATION_NOT_PROVEN", reason, querySucceeded: false });
  if (exitCode !== 0 || !experimentId || !workerVersionId) return fail("missing_query_or_correlation_identity");
  let payload;
  try { payload = JSON.parse(raw); } catch { return fail("missing_or_invalid_query_payload"); }
  if (payload?.success !== true) return fail("query_unsuccessful");
  const events = collectBudgetEvents(payload);
  const matching = events.filter(({ record, workerEvent }) => record.experimentId === experimentId && workerEvent?.scriptVersion?.id === workerVersionId);
  if (matching.length === 0) return fail("no_correlated_durable_budget_snapshot");
  if (matching.some(({ record }) => !validBudgetRecord(record))) return fail("invalid_durable_budget_snapshot");
  const configs = matching.map(({ record }) => `${record.configuredMaxNeurons}/${record.configuredReserve}`);
  if (new Set(configs).size !== 1 || configs[0] !== `${expectedConfiguredMaxNeurons}/${expectedConfiguredReserve}`) return fail("mismatched_durable_budget_configuration");
  const final = matching.map(({ record }) => record).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)).at(-1);
  if (!final || final.activeReservationCount !== 0 || final.totalReservedAllowance !== 0 || final.inferenceCount < 1) return fail("durable_budget_not_reconciled");
  return {
    classification: "DURABLE_BUDGET_RECONCILIATION_PASS",
    querySucceeded: true,
    experimentId,
    workerVersionId,
    snapshotCount: matching.length,
    finalSnapshot: {
      updatedAt: final.updatedAt,
      status: final.status,
      configuredMaxNeurons: final.configuredMaxNeurons,
      configuredReserve: final.configuredReserve,
      observedProviderNeurons: final.observedProviderNeurons,
      inferenceCount: final.inferenceCount,
      activeReservationCount: final.activeReservationCount,
      totalReservedAllowance: final.totalReservedAllowance,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  let raw = "";
  try { raw = path ? readFileSync(path, "utf8") : ""; } catch { /* absence is unknown, never zero */ }
  const result = process.env.R28_REQUIRE_DURABLE_BUDGET_RECONCILIATION === "true"
    ? classifyDurableBudgetReconciliation({
      exitCode: Number(process.env.R28_HISTORICAL_QUERY_EXIT ?? 0),
      raw,
      experimentId: process.env.R28_VALIDATION_EXPERIMENT_ID,
      workerVersionId: process.env.R28_VERSION_ID,
    })
    : classifyHistoricalObservability({ exitCode: Number(process.env.R28_HISTORICAL_QUERY_EXIT ?? 0), raw });
  console.log(JSON.stringify(result));
  if (result.classification === "BUDGET_RECONCILIATION_NOT_PROVEN") process.exitCode = 1;
}
