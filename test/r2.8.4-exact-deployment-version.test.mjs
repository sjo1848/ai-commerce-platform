import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/r2.8-multi-room-dialogue.yml", import.meta.url), "utf8");
const evalWorkflow = readFileSync(new URL("../.github/workflows/r2.6-model-eval.yml", import.meta.url), "utf8");
const dialogue = readFileSync(new URL("../scripts/r2.8-multi-room-dialogue.mjs", import.meta.url), "utf8");
const corpus = readFileSync(new URL("../scripts/r2.8.4-llm-language-corpus.mjs", import.meta.url), "utf8");

test("R2.8.4 staging binds evidence to exact deployed version and shared concurrency", () => {
  assert.match(workflow, /git rev-parse HEAD.*GITHUB_SHA/); assert.match(workflow, /--tag .*GITHUB_SHA/);
  assert.equal((workflow.match(/deployments/g) ?? []).length >= 2, true); assert.match(workflow, /deployments\?\.\[0\]/); assert.match(workflow, /versions\.length!==1/); assert.match(workflow, /percentage.*100/);
  assert.match(workflow, /--version-id .*R28_VERSION_ID/); assert.match(workflow, /r2\.8\.4-llm-language-corpus\.mjs/);
  assert.doesNotMatch(workflow, /npx wrangler/);
  assert.match(workflow, /\.\/node_modules\/\.bin\/wrangler tail/);
  assert.match(workflow, /timeout 45s script/);
  assert.match(workflow, /PROBE_TAIL_PID/);
  assert.match(workflow, /kill -0.*PROBE_TAIL_PID/);
  assert.equal((workflow.match(/\/tmp\/r28-r4-(?:probe-)?tail\.log > \/dev\/null 2>&1/g) ?? []).length, 2);
  assert.match(workflow, /PROBE_CAPTURED=false/);
  assert.match(workflow, /PROBE_FAILURE=""/);
  assert.match(workflow, /seq 1 2/);
  assert.match(workflow, /for poll in \$\(seq 1 10\)/);
  assert.match(workflow, /printf '%s' "\$status" > \/tmp\/r28-r4-probe-status\.txt/);
  assert.match(workflow, /"\$status" != "403"/);
  assert.match(workflow, /intentionally unauthenticated 403 probe/);
  assert.match(workflow, /if \[\[ "\$status" != "403" \]\]/);
  assert.doesNotMatch(workflow, /status" == 2\* \|\| "\$status" == "403"/);
  assert.match(workflow, /grep -Fq "\$probe_path" \/tmp\/r28-r4-probe-tail\.log/);
  assert.match(workflow, /tail exited while waiting to capture probe/);
  assert.match(workflow, /did not capture intentionally unauthenticated 403 probe \$probe_path within bounded interval/);
  assert.match(workflow, /kill -INT.*PROBE_TAIL_PID/);
  assert.match(workflow, /r28-r4-llm-corpus-report/); assert.match(workflow, /r28-r4-llm-corpus-code/); assert.match(workflow, /timeout 600s/); assert.match(workflow, /r2\.8\.4-llm-language-corpus/); assert.match(workflow, /ai-commerce-staging/); assert.match(evalWorkflow, /group: ai-commerce-staging/);
  assert.match(workflow, /EXPECTED_MODEL/); assert.match(workflow, /routeInferences/); assert.match(workflow, /routeFallbacks/); assert.match(workflow, /UNKNOWN_NOT_CAPTURED/);
  assert.match(workflow, /CORPUS_REPORT/); assert.match(workflow, /for \(const item of report\.transcript/); assert.match(workflow, /missing availability audit/); assert.match(workflow, /corpus mutation/); assert.doesNotMatch(workflow, /name: Run LLM language corpus/);
  const corpusGate = workflow.slice(workflow.indexOf("for (const item of report.transcript"), workflow.indexOf("EXPECTED_MODEL=\"$EXPECTED_MODEL\" MODEL_TELEMETRY", workflow.indexOf("for (const item of report.transcript")));
  assert.match(corpusGate, /UNKNOWN_NOT_CAPTURED/); assert.doesNotMatch(corpusGate, /inf\.length<2|model\.models\.includes/); assert.match(workflow, /if \(routeFallbacks\.length > 0\)/);
  const modelCounter = 'MODEL_TELEMETRY="$(R28_VERSION_ID="$R28_VERSION_ID" node scripts/count-model-telemetry.mjs /tmp/r28-r4-tail.log)"';
  const modelPostchecks = workflow.slice(workflow.indexOf(modelCounter), workflow.indexOf("AUDIT_TELEMETRY=\"$AUDIT_TELEMETRY\" REPORT_PATH", workflow.indexOf(modelCounter)));
  assert.doesNotMatch(modelPostchecks, /modelInferences === 0|routeInferences\.length <|model mismatch|missing token evidence/);
  assert.match(modelPostchecks, /status: captured \? 'CAPTURED' : 'UNKNOWN_NOT_CAPTURED'/);
  assert.match(modelPostchecks, /R28_VERSION_ID="\$R28_VERSION_ID" node scripts\/count-(?:model-telemetry|audit-events)\.mjs/);
  assert.match(dialogue, /function uniqueExactSet/); assert.match(dialogue, /approvalTargetsExact/); assert.match(dialogue, /expectedRoomIds/);
});

test("validation deployment readiness rejects 2xx and 404 instead of treating them as admitted", () => {
  const readiness = workflow.slice(
    workflow.indexOf("- name: Prove full RUN 1 readiness response before provider runner"),
    workflow.indexOf("- name: Prove foreground tail and unauthenticated observability probe"),
  );
  assert.match(readiness, /R28_READINESS_URL="\$AI_COMMERCE_STAGING_URL\/" R28_VERSION_ID="\$R28_VERSION_ID" node scripts\/r2\.8-full-run-readiness\.mjs/);
  assert.doesNotMatch(readiness, /wrangler tail|r2\.8-validation-preflight\.mjs/);
  assert.doesNotMatch(readiness, /query-workers-observability\.mjs/);
});

test("validation-admission-only mode is provider-free and correlates bindings, version, and 403 proofs", () => {
  const validation = workflow.slice(workflow.indexOf("  validation-admission:"), workflow.indexOf("  dialogue:"));
  assert.match(validation, /mode == 'validation-admission-only'/);
  assert.match(validation, /workers\/scripts\/\$WORKER_NAME\/versions\/\$R28_PRIOR_VERSION/);
  assert.match(validation, /workers\/scripts\/\$WORKER_NAME\/versions\/\$R28_VERSION_ID/);
  assert.match(validation, /workers\/scripts\/\$WORKER_NAME\/deployments/);
  assert.match(validation, /R28_VERSION_ID=.*GITHUB_SHA|tag.*GITHUB_SHA/);
  assert.match(validation, /validation root returned HTTP/);
  assert.match(validation, /Capture both-method zero-inference runtime identity proof/);
  assert.match(validation, /seq 1 4/);
  assert.match(validation, /r2\.8-runtime-version-diagnostic\.mjs/);
  assert.match(validation, /validation probe returned HTTP/);
  assert.match(validation, /R28_PROBE_PATH=.*r2\.8-validation-preflight/);
  assert.doesNotMatch(validation, /--method POST/);
  assert.match(validation, /query-workers-observability\.mjs/);
  assert.match(validation, /modelInferences !== 0/);
  assert.doesNotMatch(validation, /r2\.8-multi-room-dialogue\.mjs|r2\.8\.4-llm-language-corpus\.mjs|api\/chat|api\/approve/);
  assert.doesNotMatch(validation, /Cloudflare-Workers-Version-Overrides/);
  const tailStart = validation.indexOf("wrangler tail '$WORKER_NAME' --version-id '$R28_VERSION_ID' --format=json");
  const getLoop = validation.indexOf("for attempt in $(seq 1 4)");
  const postProbe = validation.indexOf('probe_path="/__r28-admission-probe?run=');
  assert.equal(tailStart > -1 && tailStart < getLoop && getLoop < postProbe, true, "one no-method-filter tail must span GET convergence and the unique POST");
  assert.match(validation.slice(getLoop, postProbe), /query-workers-observability\.mjs/);
  assert.doesNotMatch(validation.slice(getLoop, postProbe), /-X POST/);
  const cleanupDeploy = validation.indexOf('./node_modules/.bin/wrangler deploy --keep-vars=false --message "R2.8.4 admission proof cleanup $GITHUB_SHA"');
  const cleanupSecretDelete = validation.indexOf('printf \'y\\n\' | ./node_modules/.bin/wrangler secret delete ACP_VALIDATION_RUN_TOKEN --name "$WORKER_NAME"');
  assert.equal(cleanupSecretDelete > -1 && cleanupSecretDelete < cleanupDeploy, true, "validation secret must be deleted before cleanup version is created");
});

test("mandatory validation runners statically install validation headers through the shared helper", () => {
  for (const source of [dialogue, corpus]) {
    assert.match(source, /import \{ validationRequestHeaders \} from "\.\/validation-request-headers\.mjs"/);
    assert.match(source, /validationRequestHeaders\(/);
  }
});

test("validation admission deploy configuration is valid, run-isolated, and secret-safe", () => {
  const jobEnvironment = workflow.slice(workflow.indexOf("jobs:"), workflow.indexOf("    steps:"));
  assert.doesNotMatch(jobEnvironment, /ACP_VALIDATION_RUN_TOKEN/);
  assert.match(workflow, /Prepare valid validation admission configuration/);
  assert.equal(workflow.includes('test -n "${ACP_VALIDATION_RUN_TOKEN//[[:space:]]/}"'), true);
  assert.equal(workflow.includes('test -n "${ACP_VALIDATION_NEURON_BUDGET//[[:space:]]/}"'), true);
  assert.match(workflow, /\$\{\{ vars\.ACP_VALIDATION_NEURON_BUDGET \}\}/);
  assert.match(workflow, /R28_VALIDATION_EXPERIMENT_ID="r28-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/);
  assert.match(workflow, /parseValidationConfiguration/);
  assert.match(workflow, /configuration\.status !== "valid"/);
  assert.match(workflow, /mktemp \/tmp\/r28-validation-secrets/);
  assert.match(workflow, /trap cleanup_validation_secrets_file EXIT INT TERM/);
  assert.match(workflow, /echo "R28_VALIDATION_SECRETS_FILE=\$R28_VALIDATION_SECRETS_FILE" >> "\$GITHUB_ENV"/);
  assert.match(workflow, /trap - EXIT INT TERM/);
  assert.match(workflow, /chmodSync\(process\.env\.R28_VALIDATION_SECRETS_FILE, 0o600\)/);
  assert.match(workflow, /--var "ACP_VALIDATION_NEURON_BUDGET:\$ACP_VALIDATION_NEURON_BUDGET"/);
  assert.match(workflow, /--var "ACP_VALIDATION_EXPERIMENT_ID:\$R28_VALIDATION_EXPERIMENT_ID"/);
  assert.equal((workflow.match(/--var "ACP_VALIDATION_NEURON_BUDGET:\$ACP_VALIDATION_NEURON_BUDGET"/g) ?? []).length, 4);
  assert.equal((workflow.match(/--var "ACP_VALIDATION_EXPERIMENT_ID:\$R28_VALIDATION_EXPERIMENT_ID"/g) ?? []).length, 4);
  assert.doesNotMatch(workflow, /--var "(?:ACP_VALIDATION_NEURON_BUDGET|ACP_VALIDATION_EXPERIMENT_ID)=/);
  const validationDeploy = workflow.indexOf('./node_modules/.bin/wrangler deploy --tag "$GITHUB_SHA"');
  const dialogueStart = workflow.indexOf("  dialogue:");
  const cleanup = workflow.indexOf("- name: Remove remotely deployed validation configuration", dialogueStart);
  const cleanupDeploy = workflow.indexOf('./node_modules/.bin/wrangler deploy --keep-vars=false --message "R2.8.4 validation cleanup $GITHUB_SHA"', dialogueStart);
  const cleanupSecretDelete = workflow.indexOf('printf \'y\\n\' | ./node_modules/.bin/wrangler secret delete ACP_VALIDATION_RUN_TOKEN --name "$WORKER_NAME"', dialogueStart);
  assert.match(workflow, /echo "R28_VALIDATION_DEPLOY_ATTEMPTED=true" >> "\$GITHUB_ENV"/);
  assert.equal(workflow.indexOf('echo "R28_VALIDATION_DEPLOY_ATTEMPTED=true" >> "$GITHUB_ENV"') < validationDeploy, true, "cleanup flag must precede the real validation deploy");
  assert.match(workflow.slice(cleanup, cleanupDeploy), /if \[\[ "\$\{R28_VALIDATION_DEPLOY_ATTEMPTED:-\}" != "true" \]\]/);
  assert.equal(cleanupDeploy > cleanup, true, "cleanup must redeploy exact source after its attempt guard");
  assert.equal(cleanupSecretDelete > cleanup, true, "cleanup must delete the validation secret after its attempt guard");
  assert.equal(cleanupSecretDelete < cleanupDeploy, true, "cleanup must delete the validation secret before redeploying without validation vars");
  assert.doesNotMatch(workflow.slice(cleanupDeploy, cleanupDeploy + 250), /--var|--secrets-file/);
  assert.match(workflow.slice(cleanup, cleanupDeploy + 1), /if: always\(\)/);
  assert.match(workflow.slice(cleanupDeploy), /cleanup-version\.json/);
  assert.match(workflow.slice(cleanupDeploy), /full-run validation bindings remain after cleanup/);
  assert.match(workflow.slice(cleanupDeploy), /validation secret remains after cleanup/);
  assert.equal(cleanup > workflow.indexOf("- name: Verify exact active deployment after corpus"), true, "remote cleanup follows corpus/evidence verification");
  assert.match(workflow, /\/tmp\/r28-r4-tail\.log > \/dev\/null 2>&1/);
  assert.match(workflow, /--secrets-file "\$R28_VALIDATION_SECRETS_FILE"/);
  assert.match(workflow, /Remove temporary validation secret file/);
  assert.match(workflow, /rm -f "\$\{R28_VALIDATION_SECRETS_FILE:-\}"/);
  assert.match(workflow, /Sanitize validation headers from tail logs/);
  assert.match(workflow, /node scripts\/redact-validation-tail\.mjs \/tmp\/r28-r4-probe-tail\.log/);
  assert.match(workflow, /node scripts\/redact-validation-tail\.mjs \/tmp\/r28-r4-tail\.log/);
  assert.match(workflow, /node scripts\/redact-validation-tail\.mjs \/tmp\/r28-r4-probe-tail\.log \/tmp\/r28-r4-tail\.log/);
  assert.equal(
    workflow.indexOf("- name: Sanitize validation headers from tail logs")
      < workflow.indexOf("- name: Preserve R2.8.4 evidence"),
    true,
    "tail artifacts must be sanitized before upload",
  );
  assert.match(workflow, /id: sanitize_validation_tail_logs/);
  assert.match(workflow, /if: \$\{\{ always\(\) && steps\.sanitize_validation_tail_logs\.outcome == 'success' \}\}/);
  assert.equal(
    workflow.indexOf("node scripts/redact-validation-tail.mjs /tmp/r28-r4-probe-tail.log")
      < workflow.indexOf("cat /tmp/r28-r4-probe-tail.log"),
    true,
    "probe tail must be redacted before diagnostic output",
  );
  assert.equal(
    workflow.indexOf("node scripts/redact-validation-tail.mjs /tmp/r28-r4-tail.log")
      < workflow.indexOf("MODEL_TELEMETRY=\"$(R28_VERSION_ID=\"$R28_VERSION_ID\" node scripts/count-model-telemetry.mjs /tmp/r28-r4-tail.log)\""),
    true,
    "corpus tail must be redacted before telemetry",
  );
  for (const artifactPath of ["/tmp/r28-r4-probe-tail.log", "/tmp/r28-r4-tail.log"]) {
    assert.match(workflow, new RegExp(`node scripts/redact-validation-tail\\.mjs .*${artifactPath.slice(5).replaceAll(".", "\\.")}`));
    assert.match(workflow, new RegExp(`\\s+${artifactPath.replaceAll(".", "\\.")}\\s*$`, "m"));
  }
  assert.match(workflow, /validation_runner_token="\$ACP_VALIDATION_RUN_TOKEN"\n\s+unset ACP_VALIDATION_RUN_TOKEN/);
  assert.match(workflow, /ACP_VALIDATION_RUN_TOKEN="\$validation_runner_token" node scripts\/r2\.8-multi-room-dialogue\.mjs/);
  assert.match(workflow, /ACP_VALIDATION_RUN_TOKEN="\$validation_runner_token" node scripts\/r2\.8\.4-llm-language-corpus\.mjs/);
  assert.doesNotMatch(workflow, /env\s+ACP_VALIDATION_RUN_TOKEN=/);
});
