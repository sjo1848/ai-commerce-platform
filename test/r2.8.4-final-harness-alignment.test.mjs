import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifyDurableBudgetReconciliation, classifyHistoricalObservability } from "../scripts/r2.8-historical-observability-status.mjs";

const workflow = readFileSync(new URL("../.github/workflows/r2.8-multi-room-dialogue.yml", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");

test("empty or unavailable historical observability is UNKNOWN_NOT_VISIBLE, never zero consumption", () => {
  assert.deepEqual(classifyHistoricalObservability({ raw: JSON.stringify({ success: true, result: { events: [] } }) }), { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: true });
  assert.deepEqual(classifyHistoricalObservability({ exitCode: 1 }), { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: false });
  assert.doesNotMatch(JSON.stringify(classifyHistoricalObservability({ raw: JSON.stringify({ success: true, result: { events: [] } }) })), /consumption|zero|0/i);
});

test("durable budget reconciliation requires correlated final zero-reservation snapshot", () => {
  const experimentId = "r28-run";
  const versionId = "version-1";
  const snapshot = (updatedAt, values) => ({ event: "agent_core_experiment_budget", experimentId, updatedAt, status: "ACTIVE", configuredMaxNeurons: 7000, configuredReserve: 0, observedProviderNeurons: values.observedProviderNeurons, inferenceCount: values.inferenceCount, activeReservationCount: values.activeReservationCount, totalReservedAllowance: values.totalReservedAllowance });
  const outer = (record) => ({ $workers: { event: { scriptVersion: { id: versionId } } }, logs: [{ message: JSON.stringify(record) }] });
  const payload = { success: true, result: { events: [outer(snapshot("2030-01-01T00:00:00.000Z", { observedProviderNeurons: 0, inferenceCount: 0, activeReservationCount: 1, totalReservedAllowance: 180 })), outer(snapshot("2030-01-01T00:01:00.000Z", { observedProviderNeurons: 10, inferenceCount: 1, activeReservationCount: 0, totalReservedAllowance: 0 }))] } };
  const result = classifyDurableBudgetReconciliation({ raw: JSON.stringify(payload), experimentId, workerVersionId: versionId });
  assert.equal(result.classification, "DURABLE_BUDGET_RECONCILIATION_PASS");
  assert.equal(result.finalSnapshot.activeReservationCount, 0);
  assert.equal(classifyDurableBudgetReconciliation({ raw: JSON.stringify(payload), experimentId, workerVersionId: "wrong" }).classification, "BUDGET_RECONCILIATION_NOT_PROVEN");
  const unreconciledPayload = structuredClone(payload);
  unreconciledPayload.result.events[1].logs[0].message = JSON.stringify(snapshot("2030-01-01T00:01:00.000Z", { observedProviderNeurons: 10, inferenceCount: 1, activeReservationCount: 1, totalReservedAllowance: 180 }));
  assert.equal(classifyDurableBudgetReconciliation({ raw: JSON.stringify(unreconciledPayload), experimentId, workerVersionId: versionId }).classification, "BUDGET_RECONCILIATION_NOT_PROVEN");
});

test("full runner starts only after bounded GET convergence and synchronous admission; transport is supplemental", () => {
  const readiness = workflow.slice(workflow.indexOf("- name: Prove full RUN 1 readiness response before provider runner"), workflow.indexOf("- name: Prove synchronous unauthenticated admission"));
  const admission = workflow.slice(workflow.indexOf("- name: Prove synchronous unauthenticated admission"), workflow.indexOf("- name: Historical observability preflight query"));
  const historical = workflow.slice(workflow.indexOf("- name: Historical observability preflight query"), workflow.indexOf("- name: Real-model natural multi-room dialogue"));
  const broadHistorical = workflow.slice(workflow.indexOf("- name: Preserve broad historical evidence"), workflow.indexOf("- name: Remove remotely deployed validation configuration"));
  assert.match(readiness, /R28_READINESS_URL=.*R28_VERSION_ID=.*r2\.8-full-run-readiness\.mjs/);
  assert.doesNotMatch(readiness, /wrangler tail|r2\.8-validation-preflight|grep -Fq|query-workers-observability/);
  assert.doesNotMatch(readiness, /query-workers-observability/);
  assert.match(admission, /curl -sS.*-X POST/);
  assert.match(admission, /status" != "403"/);
  assert.doesNotMatch(admission, /wrangler tail|grep -Fq|r2\.8-validation-preflight/);
  assert.match(historical, /set \+e/);
  assert.match(historical, /r2\.8-historical-observability-status\.mjs/);
  assert.match(historical, /UNKNOWN_NOT_VISIBLE, never zero consumption/);
  assert.match(broadHistorical, /set \+e/);
  assert.match(broadHistorical, /UNKNOWN_NOT_VISIBLE, never zero consumption/);
  assert.match(broadHistorical, /R28_REQUIRE_DURABLE_BUDGET_RECONCILIATION=true/);
  assert.match(workflow, /r28-r4-budget-reconciliation\.json/);
  assert.equal(workflow.indexOf("- name: Real-model natural multi-room dialogue") > workflow.indexOf("- name: Prove synchronous unauthenticated admission"), true);
  assert.match(workflow, /if \[\[ "\$code" -ne 0 \]\]; then[\s\S]*?exit 0[\s\S]*?node scripts\/r2\.8\.4-llm-language-corpus/);
});

test("validation-admission-only uses direct response proof and leaves telemetry supplemental", () => {
  const validation = workflow.slice(workflow.indexOf("  validation-admission:"), workflow.indexOf("  dialogue:"));
  assert.match(validation, /DIRECT_PRE_ADMISSION_RUNTIME_PROOF/);
  assert.match(validation, /status: 403/);
  assert.match(validation, /runtimeWorkerVersionId: observedVersion/);
  assert.match(validation, /validationStatus: "valid"/);
  assert.match(validation, /telemetry: "UNKNOWN_NOT_CAPTURED"/);
  assert.doesNotMatch(validation, /wrangler tail|query-workers-observability|r2\.8-validation-preflight/);
});

test("validation identity header is derived only from immutable runtime metadata and is absent when validation is disabled", () => {
  assert.match(worker, /VALIDATION_RUNTIME_VERSION_HEADER = "x-acp-validation-runtime-version"/);
  assert.match(worker, /typeof env\.CF_VERSION_METADATA\?\.id === "string"/);
  assert.match(worker, /headers\.set\(VALIDATION_RUNTIME_VERSION_HEADER, env\.CF_VERSION_METADATA\.id\)/);
  assert.match(worker, /validationConfiguration\.status === "disabled" \? undefined : \(\) => validationDeniedResponse\(env\)/);
  const response = worker.slice(worker.indexOf("function validationDeniedResponse"), worker.indexOf("function handler"));
  assert.doesNotMatch(response, /GITHUB_SHA|request\.|token|ACP_VALIDATION_RUN_TOKEN|ACP_VALIDATION_EXPERIMENT_ID/);
});
