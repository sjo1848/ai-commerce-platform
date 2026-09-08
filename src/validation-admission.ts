/** Credential accepted only by a validation deployment's outer admission boundary. */
export const VALIDATION_RUN_TOKEN_HEADER = "x-acp-validation-run-token";
/** Server-owned format used for validation experiment budget durable-object names. */
export const VALIDATION_EXPERIMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type ValidationAdmissionConfig = {
  ACP_VALIDATION_NEURON_BUDGET?: string;
  ACP_VALIDATION_EXPERIMENT_ID?: string;
  ACP_VALIDATION_RUN_TOKEN?: string;
};

export type ValidationConfiguration =
  | { status: "disabled" }
  | { status: "invalid" }
  | {
    status: "valid";
    budget: {
      maxNeuronsPerRun: number;
      configuredAvailableBudget: number;
      configuredReserve: number;
      conservativeExpectedCost: number;
      observedLocalDayNeurons?: number;
    };
    experimentId: string;
    expectedToken: string;
  };

export type ValidationAdmission =
  | { active: false }
  | { active: true; expectedToken?: string };

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Parses the complete validation-only configuration once at the outer boundary.
 * Invalid configuration deliberately has no details: it is only ever admitted
 * as a generic 403 and cannot reach application construction.
 */
export function parseValidationConfiguration(config: ValidationAdmissionConfig): ValidationConfiguration {
  const budgetValue = config.ACP_VALIDATION_NEURON_BUDGET;
  const experimentId = config.ACP_VALIDATION_EXPERIMENT_ID;
  const expectedToken = config.ACP_VALIDATION_RUN_TOKEN;
  if (budgetValue === undefined && experimentId === undefined && expectedToken === undefined) return { status: "disabled" };
  if (typeof budgetValue !== "string" || !budgetValue.trim()
    || typeof experimentId !== "string" || !VALIDATION_EXPERIMENT_ID_PATTERN.test(experimentId)
    || typeof expectedToken !== "string" || !expectedToken.trim()) return { status: "invalid" };

  let parsed: unknown;
  try { parsed = JSON.parse(budgetValue); } catch { return { status: "invalid" }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "invalid" };
  const raw = parsed as Record<string, unknown>;
  const maxNeuronsPerRun = raw.maxNeuronsPerRun;
  const configuredAvailableBudget = raw.configuredAvailableBudget;
  const configuredReserve = raw.configuredReserve;
  const conservativeExpectedCost = raw.conservativeExpectedCost;
  const observedLocalDayNeurons = raw.observedLocalDayNeurons;
  if (!isFiniteNonNegative(maxNeuronsPerRun)
    || !isFiniteNonNegative(configuredAvailableBudget)
    || !isFiniteNonNegative(configuredReserve)
    || !isFiniteNonNegative(conservativeExpectedCost) || conservativeExpectedCost <= 0
    || (observedLocalDayNeurons !== undefined && !isFiniteNonNegative(observedLocalDayNeurons))) return { status: "invalid" };
  const budget = {
    maxNeuronsPerRun,
    configuredAvailableBudget,
    configuredReserve,
    conservativeExpectedCost,
  };
  return observedLocalDayNeurons === undefined
    ? { status: "valid", budget, experimentId, expectedToken }
    : { status: "valid", budget: { ...budget, observedLocalDayNeurons }, experimentId, expectedToken };
}

/**
 * Any validation configuration enables the boundary. A partially configured
 * validation deployment deliberately has no expected token and is denied.
 */
export function validationAdmission(config: ValidationAdmissionConfig): ValidationAdmission {
  return validationAdmissionFor(parseValidationConfiguration(config));
}

function validationAdmissionFor(configuration: ValidationConfiguration): ValidationAdmission {
  if (configuration.status === "disabled") return { active: false };
  return configuration.status === "valid"
    ? { active: true, expectedToken: configuration.expectedToken }
    : { active: true };
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
  config: ValidationAdmissionConfig | ValidationConfiguration,
  next: (admittedRequest: Request) => Promise<Response>,
): Promise<Response> {
  const configuration = "status" in config ? config : parseValidationConfiguration(config);
  const admission = validationAdmissionFor(configuration);
  if (!admission.active) return next(request);
  if (!admission.expectedToken || !tokensMatch(request.headers.get(VALIDATION_RUN_TOKEN_HEADER), admission.expectedToken)) {
    return Promise.resolve(new Response("Forbidden", { status: 403 }));
  }
  return next(withoutValidationToken(request));
}
