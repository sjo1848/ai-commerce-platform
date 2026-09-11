export const VALIDATION_RUN_TOKEN_HEADER = "x-acp-validation-run-token";
export const VERSION_OVERRIDE_HEADER = "Cloudflare-Workers-Version-Overrides";
const DEFAULT_WORKER_NAME = "ai-commerce-agent-core";

/**
 * Adds the server validation credential only for an explicitly configured run.
 * The returned value is a request-header object only; callers must not log it.
 */
export function validationRequestHeaders(headers, environment = process.env) {
  const result = { ...headers };
  for (const name of Object.keys(result)) {
    if (name.toLowerCase() === VALIDATION_RUN_TOKEN_HEADER) delete result[name];
    if (name.toLowerCase() === VERSION_OVERRIDE_HEADER.toLowerCase()) delete result[name];
  }

  const token = environment.ACP_VALIDATION_RUN_TOKEN;
  if (typeof token === "string" && token.trim().length > 0) {
    result[VALIDATION_RUN_TOKEN_HEADER] = token;
  }
  const versionId = environment.R28_VERSION_ID;
  if (typeof versionId === "string" && versionId.trim().length > 0) {
    const workerName = environment.R28_WORKER_NAME || environment.WORKER_NAME || DEFAULT_WORKER_NAME;
    result[VERSION_OVERRIDE_HEADER] = `${workerName}="${versionId.trim()}"`;
  }
  return result;
}
