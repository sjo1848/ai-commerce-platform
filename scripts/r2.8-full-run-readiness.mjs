import { pathToFileURL } from "node:url";

const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 1_000;

const runtimeVersion = (response) => response.headers.get("x-acp-validation-runtime-version");

export async function proveFullRunReadiness({
  url,
  versionId,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelayMs = RETRY_DELAY_MS,
} = {}) {
  if (!url || !versionId) throw new Error("readiness URL and exact runtime version are required");

  const attempts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const observedVersionId = runtimeVersion(response);
      const valid = response.status === 403 && observedVersionId === versionId;
      attempts.push({ attempt, status: response.status, runtimeVersionId: observedVersionId ?? null, valid });
      if (valid) return { event: "EXACT_ACTIVE_RUNTIME_RESPONSE", attempt, status: response.status, runtimeVersionId: observedVersionId };
    } catch (error) {
      attempts.push({ attempt, status: "request-error", runtimeVersionId: null, valid: false, error: error instanceof Error ? error.name : "request-error" });
    }
    if (attempt < MAX_ATTEMPTS) await sleep(retryDelayMs);
  }

  throw new Error(`full-run readiness did not converge after ${MAX_ATTEMPTS} GET attempts: ${JSON.stringify(attempts)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  proveFullRunReadiness({ url: process.env.R28_READINESS_URL, versionId: process.env.R28_VERSION_ID })
    .then((proof) => process.stdout.write(`${JSON.stringify(proof)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
