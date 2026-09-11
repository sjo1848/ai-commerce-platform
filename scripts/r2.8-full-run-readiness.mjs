import { pathToFileURL } from "node:url";
import { validationRequestHeaders } from "./validation-request-headers.mjs";

const MAX_HORIZON_MS = 30_000;
const OBSERVATION_INTERVAL_MS = 5_000;
const MAX_ATTEMPTS = 6;

const runtimeVersion = (response) => response.headers.get("x-acp-validation-runtime-version");

export async function proveFullRunReadiness({
  url,
  versionId,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  clock = () => Date.now(),
} = {}) {
  if (!url || !versionId) throw new Error("readiness URL and exact runtime version are required");

  const attempts = [];
  const startedAt = clock();
  const deadline = startedAt + MAX_HORIZON_MS;
  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    const now = clock();
    if (now >= deadline) break;
    attempt += 1;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        headers: validationRequestHeaders({}, { ...process.env, R28_VERSION_ID: versionId }),
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - now))),
      });
      const observedVersionId = runtimeVersion(response);
      const runtimeVersionPresent = observedVersionId !== null;
      const runtimeVersionMatches = runtimeVersionPresent && observedVersionId === versionId;
      const evidence = {
        attempt,
        elapsedMs: Math.max(0, clock() - startedAt),
        status: response.status,
        runtimeVersionPresent,
        runtimeVersionMatches,
      };
      attempts.push(evidence);
      if (clock() >= deadline) break;
      if (response.status === 403 && runtimeVersionPresent && runtimeVersionMatches) {
        return { event: "EXACT_ACTIVE_RUNTIME_RESPONSE", ...evidence, attempts };
      }
    } catch {
      attempts.push({
        attempt,
        elapsedMs: Math.max(0, clock() - startedAt),
        status: "request-error",
        runtimeVersionPresent: false,
        runtimeVersionMatches: false,
      });
    }
    const remainingMs = deadline - clock();
    if (remainingMs <= 0 || attempt >= MAX_ATTEMPTS) break;
    await sleep(Math.min(OBSERVATION_INTERVAL_MS, remainingMs));
    if (clock() >= deadline) break;
  }

  throw new Error(`full-run readiness did not converge within ${MAX_HORIZON_MS}ms: ${JSON.stringify(attempts)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  proveFullRunReadiness({ url: process.env.R28_READINESS_URL, versionId: process.env.R28_VERSION_ID })
    .then((proof) => process.stdout.write(`${JSON.stringify(proof)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
