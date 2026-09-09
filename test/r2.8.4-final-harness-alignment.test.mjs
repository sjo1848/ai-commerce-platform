import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifyHistoricalObservability } from "../scripts/r2.8-historical-observability-status.mjs";

const workflow = readFileSync(new URL("../.github/workflows/r2.8-multi-room-dialogue.yml", import.meta.url), "utf8");

test("empty or unavailable historical observability is UNKNOWN_NOT_VISIBLE, never zero consumption", () => {
  assert.deepEqual(classifyHistoricalObservability({ raw: JSON.stringify({ success: true, result: { events: [] } }) }), { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: true });
  assert.deepEqual(classifyHistoricalObservability({ exitCode: 1 }), { classification: "UNKNOWN_NOT_VISIBLE", querySucceeded: false });
  assert.doesNotMatch(JSON.stringify(classifyHistoricalObservability({ raw: JSON.stringify({ success: true, result: { events: [] } }) })), /consumption|zero|0/i);
});

test("full runner starts only after direct live readiness and historical query is supplemental", () => {
  const readiness = workflow.slice(workflow.indexOf("- name: Prove full RUN 1 live readiness before provider runner"), workflow.indexOf("- name: Prove foreground tail"));
  const historical = workflow.slice(workflow.indexOf("- name: Historical observability preflight query"), workflow.indexOf("- name: Real-model natural multi-room dialogue"));
  const broadHistorical = workflow.slice(workflow.indexOf("- name: Preserve broad historical evidence"), workflow.indexOf("- name: Remove remotely deployed validation configuration"));
  assert.match(readiness, /wrangler tail '\$WORKER_NAME' --version-id '\$R28_VERSION_ID' --format=json/);
  assert.match(readiness, /\$status" != "403"/);
  assert.match(readiness, /R28_READINESS_ROOT_ONLY=true/);
  assert.doesNotMatch(readiness, /query-workers-observability/);
  assert.match(historical, /set \+e/);
  assert.match(historical, /r2\.8-historical-observability-status\.mjs/);
  assert.match(historical, /UNKNOWN_NOT_VISIBLE, never zero consumption/);
  assert.match(broadHistorical, /set \+e/);
  assert.match(broadHistorical, /UNKNOWN_NOT_VISIBLE, never zero consumption/);
  assert.equal(workflow.indexOf("- name: Real-model natural multi-room dialogue") > workflow.indexOf("- name: Prove full RUN 1 live readiness before provider runner"), true);
  assert.match(workflow, /if \[\[ "\$code" -ne 0 \]\]; then[\s\S]*?exit 0[\s\S]*?node scripts\/r2\.8\.4-llm-language-corpus/);
});
