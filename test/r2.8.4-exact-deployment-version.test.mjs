import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/r2.8-multi-room-dialogue.yml", "utf8");

function stepBody(name, nextName) {
  const start = workflow.indexOf(`- name: ${name}`);
  const end = workflow.indexOf(`- name: ${nextName}`, start + 1);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  assert.notEqual(end, -1, `missing following workflow step: ${nextName}`);
  return workflow.slice(start, end);
}

test("R2.8.4 newest Codex P2: readiness verifies the exact active Worker version before corpus", () => {
  const readiness = stepBody("Wait for exact staging deployment", "Real-model natural multi-room dialogue");

  assert.match(readiness, /workers\/scripts\/\$WORKER_NAME\/deployments/);
  assert.match(readiness, /R28_VERSION_ID/);
  assert.match(readiness, /version_id/);
  assert.match(readiness, /percentage/);
  assert.match(readiness, /100/);
});
