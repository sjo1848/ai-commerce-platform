import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/r2.8-multi-room-dialogue.yml", import.meta.url), "utf8");
const evalWorkflow = readFileSync(new URL("../.github/workflows/r2.6-model-eval.yml", import.meta.url), "utf8");
const dialogue = readFileSync(new URL("../scripts/r2.8-multi-room-dialogue.mjs", import.meta.url), "utf8");

test("R2.8.4 staging binds evidence to exact deployed version and shared concurrency", () => {
  assert.match(workflow, /git rev-parse HEAD.*GITHUB_SHA/); assert.match(workflow, /--tag .*GITHUB_SHA/);
  assert.equal((workflow.match(/deployments/g) ?? []).length >= 2, true); assert.match(workflow, /deployments\?\.\[0\]/); assert.match(workflow, /versions\.length!==1/); assert.match(workflow, /percentage.*100/);
  assert.match(workflow, /--version-id .*R28_VERSION_ID/); assert.match(workflow, /r2\.8\.4-llm-language-corpus\.mjs/);
  assert.doesNotMatch(workflow, /npx wrangler/);
  assert.match(workflow, /\.\/node_modules\/\.bin\/wrangler tail/);
  assert.match(workflow, /timeout 45s script/);
  assert.match(workflow, /PROBE_TAIL_PID/);
  assert.match(workflow, /kill -0.*PROBE_TAIL_PID/);
  assert.doesNotMatch(workflow, /-s \/tmp\/r28-r4-probe-tail\.log/);
  assert.match(workflow, /PROBE_CAPTURED=false/);
  assert.match(workflow, /PROBE_FAILURE=""/);
  assert.match(workflow, /seq 1 2/);
  assert.match(workflow, /for poll in \$\(seq 1 10\)/);
  assert.match(workflow, /printf '%s' "\$status" > \/tmp\/r28-r4-probe-status\.txt/);
  assert.match(workflow, /if \[\[ "\$status" != "404" \]\]/);
  assert.doesNotMatch(workflow, /status" == "404" \]\] && grep -Fq/);
  assert.match(workflow, /grep -Fq "\$probe_path" \/tmp\/r28-r4-probe-tail\.log/);
  assert.match(workflow, /tail exited while waiting to capture probe/);
  assert.match(workflow, /did not capture 404 probe \$probe_path within bounded interval/);
  assert.match(workflow, /kill -INT.*PROBE_TAIL_PID/);
  assert.match(workflow, /r28-r4-llm-corpus-report/); assert.match(workflow, /r28-r4-llm-corpus-code/); assert.match(workflow, /timeout 600s/); assert.match(workflow, /r2\.8\.4-llm-language-corpus/); assert.match(workflow, /ai-commerce-staging/); assert.match(evalWorkflow, /group: ai-commerce-staging/);
  assert.match(workflow, /EXPECTED_MODEL/); assert.match(workflow, /routeInferences/); assert.match(workflow, /routeFallbacks/);
  assert.match(workflow, /CORPUS_REPORT/); assert.match(workflow, /for \(const item of report\.transcript/); assert.match(workflow, /missing availability audit/); assert.match(workflow, /corpus mutation/); assert.doesNotMatch(workflow, /name: Run LLM language corpus/);
  assert.match(dialogue, /function uniqueExactSet/); assert.match(dialogue, /approvalTargetsExact/); assert.match(dialogue, /expectedRoomIds/);
});
