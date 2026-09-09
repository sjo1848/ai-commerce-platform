import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifyHistoricalObservability } from "../scripts/r2.8-historical-observability-status.mjs";

const workflow = readFileSync(new URL("../.github/workflows/r2.8-multi-room-dialogue.yml", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");

test("empty or unavailable historical observability is UNKNOWN_NOT_VISIBLE, never zero consumption", () => {
  assert.deepEqual(classifyHistoricalObservability({ raw: JSON.stringify({ success: true, result: { events: [] } }) }), { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: true });
  assert.deepEqual(classifyHistoricalObservability({ exitCode: 1 }), { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: false });
  assert.doesNotMatch(JSON.stringify(classifyHistoricalObservability({ raw: JSON.stringify({ success: true, result: { events: [] } }) })), /consumption|zero|0/i);
});

test("full runner starts only after bounded GET convergence proves exact 403 runtime identity and historical query is supplemental", () => {
  const readiness = workflow.slice(workflow.indexOf("- name: Prove full RUN 1 readiness response before provider runner"), workflow.indexOf("- name: Prove foreground tail"));
  const historical = workflow.slice(workflow.indexOf("- name: Historical observability preflight query"), workflow.indexOf("- name: Real-model natural multi-room dialogue"));
  const broadHistorical = workflow.slice(workflow.indexOf("- name: Preserve broad historical evidence"), workflow.indexOf("- name: Remove remotely deployed validation configuration"));
  assert.match(readiness, /R28_READINESS_URL=.*R28_VERSION_ID=.*r2\.8-full-run-readiness\.mjs/);
  assert.doesNotMatch(readiness, /wrangler tail|r2\.8-validation-preflight|grep -Fq|query-workers-observability/);
  assert.doesNotMatch(readiness, /query-workers-observability/);
  assert.match(historical, /set \+e/);
  assert.match(historical, /r2\.8-historical-observability-status\.mjs/);
  assert.match(historical, /UNKNOWN_NOT_VISIBLE, never zero consumption/);
  assert.match(broadHistorical, /set \+e/);
  assert.match(broadHistorical, /UNKNOWN_NOT_VISIBLE, never zero consumption/);
  assert.equal(workflow.indexOf("- name: Real-model natural multi-room dialogue") > workflow.indexOf("- name: Prove full RUN 1 readiness response before provider runner"), true);
  assert.match(workflow, /if \[\[ "\$code" -ne 0 \]\]; then[\s\S]*?exit 0[\s\S]*?node scripts\/r2\.8\.4-llm-language-corpus/);
});

test("validation identity header is derived only from immutable runtime metadata and is absent when validation is disabled", () => {
  assert.match(worker, /VALIDATION_RUNTIME_VERSION_HEADER = "x-acp-validation-runtime-version"/);
  assert.match(worker, /typeof env\.CF_VERSION_METADATA\?\.id === "string"/);
  assert.match(worker, /headers\.set\(VALIDATION_RUNTIME_VERSION_HEADER, env\.CF_VERSION_METADATA\.id\)/);
  assert.match(worker, /validationConfiguration\.status === "disabled" \? undefined : \(\) => validationDeniedResponse\(env\)/);
  const response = worker.slice(worker.indexOf("function validationDeniedResponse"), worker.indexOf("function handler"));
  assert.doesNotMatch(response, /GITHUB_SHA|request\.|token|ACP_VALIDATION_RUN_TOKEN|ACP_VALIDATION_EXPERIMENT_ID/);
});
