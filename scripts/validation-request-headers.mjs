export const VALIDATION_RUN_TOKEN_HEADER = "x-acp-validation-run-token";

/**
 * Adds the server validation credential only for an explicitly configured run.
 * The returned value is a request-header object only; callers must not log it.
 */
export function validationRequestHeaders(headers, environment = process.env) {
  const result = { ...headers };
  for (const name of Object.keys(result)) {
    if (name.toLowerCase() === VALIDATION_RUN_TOKEN_HEADER) delete result[name];
  }

  const token = environment.ACP_VALIDATION_RUN_TOKEN;
  if (typeof token === "string" && token.trim().length > 0) {
    result[VALIDATION_RUN_TOKEN_HEADER] = token;
  }
  return result;
}
