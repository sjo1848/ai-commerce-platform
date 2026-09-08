import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EVENT = "acp_validation_runtime_identity";

function jsonValues(value, output = []) {
  if (typeof value === "string") {
    try { jsonValues(JSON.parse(value), output); } catch { /* logs may be plain text */ }
  } else if (Array.isArray(value)) {
    for (const item of value) jsonValues(item, output);
  } else if (value && typeof value === "object") {
    if (value.event === EVENT) output.push(value);
    for (const item of Object.values(value)) jsonValues(item, output);
  }
  return output;
}

/**
 * Historical evidence is authoritative for runtime identity. A transmitted
 * Cloudflare-Workers-Version-Overrides header is deliberately not used: local
 * Wrangler 4.127.1 help/config exposes version_metadata but provides no
 * verifiable override-request contract, and sending a header is not proof of
 * the serving version.
 */
export function verifyRuntimeVersionDiagnostic(payload, { version, method = "GET", pathname = "/", status = "valid" }) {
  if (!version) throw new Error("exact version required");
  const candidates = jsonValues(payload).filter((item) => item
    && item.runtimeWorkerVersionId === version
    && item.method === method
    && item.pathname === pathname
    && item.validationStatus === status
    && item.validationNeuronBudgetPresent === true
    && item.validationExperimentIdPresent === true
    && item.validationRunTokenPresent === true);
  if (candidates.length !== 1) {
    const mismatched = jsonValues(payload).some((item) => item?.event === EVENT
      && item.method === method && item.pathname === pathname && item.validationStatus === status
      && item.validationNeuronBudgetPresent === true && item.validationExperimentIdPresent === true && item.validationRunTokenPresent === true);
    throw new Error(`${mismatched ? "MISMATCH" : "UNKNOWN"}: expected one exact runtime version diagnostic`);
  }
  return { event: EVENT, runtimeWorkerVersionId: version, method, pathname, validationStatus: status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));
  console.log(JSON.stringify(verifyRuntimeVersionDiagnostic(payload, { version: process.env.R28_VERSION_ID })));
}
