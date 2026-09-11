export type RuntimeValidationDiagnosticInput = {
  request: Request;
  runtimeWorkerVersionId: unknown;
  validationNeuronBudgetPresent: boolean;
  validationExperimentIdPresent: boolean;
  validationRunTokenPresent: boolean;
  validationStatus: "disabled" | "invalid" | "valid";
};

function sanitizedPathname(request: Request): string {
  let pathname = "/";
  try { pathname = new URL(request.url).pathname; } catch { /* retain safe root */ }
  return pathname.replace(/[^A-Za-z0-9._~!$&'()*+,;=:@%/-]/g, "_").slice(0, 128) || "/";
}

/** A presence-only runtime identity diagnostic safe for Worker observability. */
export function runtimeValidationDiagnostic(input: RuntimeValidationDiagnosticInput): Record<string, unknown> {
  return {
    event: "acp_validation_runtime_identity",
    runtimeWorkerVersionId: typeof input.runtimeWorkerVersionId === "string" ? input.runtimeWorkerVersionId : null,
    method: input.request.method,
    pathname: sanitizedPathname(input.request),
    validationNeuronBudgetPresent: input.validationNeuronBudgetPresent,
    validationExperimentIdPresent: input.validationExperimentIdPresent,
    validationRunTokenPresent: input.validationRunTokenPresent,
    validationStatus: input.validationStatus,
  };
}
