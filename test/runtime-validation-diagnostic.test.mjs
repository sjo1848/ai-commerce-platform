import assert from "node:assert/strict";
import test from "node:test";
import { runtimeValidationDiagnostic } from "../dist/runtime-validation-diagnostic.js";
import { verifyRuntimeVersionDiagnostic } from "../scripts/r2.8-runtime-version-diagnostic.mjs";

test("runtime diagnostic is bounded, presence-only, and distinguishes disabled bindings", () => {
  const secret = "do-not-log-validation-token";
  const budget = '{"secret":"do-not-log-budget"}';
  const diagnostic = runtimeValidationDiagnostic({
    request: new Request(`https://example.test/a path?token=${secret}&budget=${budget}`, { method: "GET" }),
    runtimeWorkerVersionId: "target-version",
    validationNeuronBudgetPresent: true,
    validationExperimentIdPresent: true,
    validationRunTokenPresent: true,
    validationStatus: "valid",
  });
  const serialized = JSON.stringify(diagnostic);
  assert.equal(diagnostic.pathname, "/a%20path");
  assert.equal(diagnostic.validationRunTokenPresent, true);
  assert.doesNotMatch(serialized, /do-not-log|token=|budget=/);
  const disabled = runtimeValidationDiagnostic({
    request: new Request("https://example.test/"), runtimeWorkerVersionId: "version",
    validationNeuronBudgetPresent: false, validationExperimentIdPresent: false, validationRunTokenPresent: false, validationStatus: "disabled",
  });
  assert.equal(disabled.validationStatus, "disabled");
  assert.equal(disabled.validationNeuronBudgetPresent, false);
  assert.equal(disabled.validationExperimentIdPresent, false);
  assert.equal(disabled.validationRunTokenPresent, false);
  assert.doesNotMatch(JSON.stringify(disabled), /do-not-log|token=|budget=/);
});

test("historical runtime identity proof rejects missing and mismatched versions", () => {
  const event = { event: "acp_validation_runtime_identity", runtimeWorkerVersionId: "target", method: "GET", pathname: "/", validationNeuronBudgetPresent: true, validationExperimentIdPresent: true, validationRunTokenPresent: true, validationStatus: "valid" };
  assert.equal(verifyRuntimeVersionDiagnostic({ result: { events: [{ logs: [JSON.stringify(event)] }] } }, { version: "target" }).runtimeWorkerVersionId, "target");
  assert.throws(() => verifyRuntimeVersionDiagnostic({ logs: [JSON.stringify({ ...event, runtimeWorkerVersionId: "other" })] }, { version: "target" }), /MISMATCH/);
  assert.throws(() => verifyRuntimeVersionDiagnostic({}, { version: "target" }), /UNKNOWN/);
});
