/** Credential accepted only by a validation deployment's outer admission boundary. */
export const VALIDATION_RUN_TOKEN_HEADER = "x-acp-validation-run-token";

export type ValidationAdmissionConfig = {
  ACP_VALIDATION_NEURON_BUDGET?: string;
  ACP_VALIDATION_EXPERIMENT_ID?: string;
  ACP_VALIDATION_RUN_TOKEN?: string;
};

type ValidationAdmission =
  | { active: false }
  | { active: true; expectedToken?: string };

/**
 * Any validation configuration enables the boundary. A partially configured
 * validation deployment deliberately has no expected token and is denied.
 */
export function validationAdmission(config: ValidationAdmissionConfig): ValidationAdmission {
  const values = [
    config.ACP_VALIDATION_NEURON_BUDGET,
    config.ACP_VALIDATION_EXPERIMENT_ID,
    config.ACP_VALIDATION_RUN_TOKEN,
  ];
  if (values.every((value) => value === undefined)) return { active: false };
  if (values.some((value) => !value)) return { active: true };
  const expectedToken = config.ACP_VALIDATION_RUN_TOKEN;
  if (!expectedToken) return { active: true };
  return { active: true, expectedToken };
}

function tokensMatch(actual: string | null, expected: string): boolean {
  // Compare every expected character even when the supplied length is wrong.
  // This is intentionally only constant-time-ish: Workers provides no
  // dependency-free cryptographic string comparator for configuration secrets.
  const supplied = actual ?? "";
  let mismatch = supplied.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ (index < supplied.length ? supplied.charCodeAt(index) : 0);
  }
  return mismatch === 0;
}

function withoutValidationToken(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(VALIDATION_RUN_TOKEN_HEADER);
  return new Request(request, { headers });
}

/**
 * Runs before Agent Core construction. The token is an admission credential,
 * never application input, so admitted requests are rebuilt without it.
 */
export function admitValidationRequest(
  request: Request,
  config: ValidationAdmissionConfig,
  next: (admittedRequest: Request) => Promise<Response>,
): Promise<Response> {
  const admission = validationAdmission(config);
  if (!admission.active) return next(request);
  if (!admission.expectedToken || !tokensMatch(request.headers.get(VALIDATION_RUN_TOKEN_HEADER), admission.expectedToken)) {
    return Promise.resolve(new Response("Forbidden", { status: 403 }));
  }
  return next(withoutValidationToken(request));
}
