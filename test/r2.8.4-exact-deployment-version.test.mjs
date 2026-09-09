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
  assert.doesNotMatch(workflow.slice(workflow.indexOf("- name: Prove synchronous unauthenticated admission"), workflow.indexOf("- name: Historical observability preflight query")), /wrangler tail|PROBE_TAIL_PID|grep -Fq/);
  assert.match(workflow, /printf '%s' "\$status" > \/tmp\/r28-r4-probe-status\.txt/);
  assert.match(workflow, /"\$status" != "403"/);
  assert.match(workflow, /validation admission probe returned HTTP/);
  assert.match(workflow, /if \[\[ "\$status" != "403" \]\]/);
  assert.doesNotMatch(workflow, /status" == 2\* \|\| "\$status" == "403"/);
  assert.match(workflow, /r28-r4-llm-corpus-report/); assert.match(workflow, /r28-r4-llm-corpus-code/); assert.match(workflow, /timeout 600s/); assert.match(workflow, /r2\.8\.4-llm-language-corpus/); assert.match(workflow, /ai-commerce-staging/); assert.match(evalWorkflow, /group: ai-commerce-staging/);
  assert.match(workflow, /EXPECTED_MODEL/); assert.match(workflow, /UNKNOWN_NOT_CAPTURED/);
  assert.match(workflow, /CORPUS_REPORT/); assert.match(workflow, /direct corpus predicate failed/); assert.doesNotMatch(workflow, /missing availability audit|corpus mutation/); assert.doesNotMatch(workflow, /name: Run LLM language corpus/);
  assert.match(workflow, /direct composite HITL\/no-mutation proof failed/);
  assert.match(dialogue, /function uniqueExactSet/); assert.match(dialogue, /approvalTargetsExact/); assert.match(dialogue, /expectedRoomIds/);
});

test("validation deployment readiness rejects 2xx and 404 instead of treating them as admitted", () => {
  const readiness = workflow.slice(
    workflow.indexOf("- name: Prove full RUN 1 readiness response before provider runner"),
    workflow.indexOf("- name: Prove synchronous unauthenticated admission before provider runner"),
  );
  assert.match(readiness, /R28_READINESS_URL="\$AI_COMMERCE_STAGING_URL\/" R28_VERSION_ID="\$R28_VERSION_ID" node scripts\/r2\.8-full-run-readiness\.mjs/);
  assert.doesNotMatch(readiness, /wrangler tail|r2\.8-validation-preflight\.mjs/);
  assert.doesNotMatch(readiness, /query-workers-observability\.mjs/);
});

test("validation-admission-only mode is provider-free and uses direct pre-admission binding/version/403 proof", () => {
  const validation = workflow.slice(workflow.indexOf("  validation-admission:"), workflow.indexOf("  dialogue:"));
  assert.match(validation, /mode == 'validation-admission-only'/);
  assert.match(validation, /workers\/scripts\/\$WORKER_NAME\/versions\/\$R28_PRIOR_VERSION/);
  assert.match(validation, /workers\/scripts\/\$WORKER_NAME\/versions\/\$R28_VERSION_ID/);
  assert.match(validation, /workers\/scripts\/\$WORKER_NAME\/deployments/);
  assert.match(validation, /R28_VERSION_ID=.*GITHUB_SHA|tag.*GITHUB_SHA/);
  assert.match(validation, /validation root returned HTTP/);
  assert.match(validation, /Capture direct pre-admission runtime identity proof/);
  assert.match(validation, /-D \/tmp\/r28-admission-root-headers\.txt/);
  assert.match(validation, /x-acp-validation-runtime-version/);
  assert.match(validation, /DIRECT_PRE_ADMISSION_RUNTIME_PROOF/);
  assert.match(validation, /applicationRequest: false/);
  assert.match(validation, /telemetry: "UNKNOWN_NOT_CAPTURED"/);
  assert.doesNotMatch(validation, /wrangler tail|query-workers-observability|r2\.8-runtime-version-diagnostic|r2\.8-validation-preflight|count-model-telemetry|count-audit-events/);
  assert.doesNotMatch(validation, /-X POST/);
  assert.doesNotMatch(validation, /r2\.8-multi-room-dialogue\.mjs|r2\.8\.4-llm-language-corpus\.mjs|api\/chat|api\/approve/);
  assert.doesNotMatch(validation, /Cloudflare-Workers-Version-Overrides/);
  assert.match(validation, /status !== "403"/);
  assert.match(validation, /observedVersion !== version/);
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
  assert.match(workflow, /MODEL_TELEMETRY='\{"status":"UNKNOWN_NOT_CAPTURED"\}'/);
  for (const artifactPath of ["/tmp/r28-r4-probe-tail.log", "/tmp/r28-r4-tail.log"]) {
    assert.match(workflow, new RegExp(`node scripts/redact-validation-tail\\.mjs .*${artifactPath.slice(5).replaceAll(".", "\\.")}`));
    assert.match(workflow, new RegExp(`\\s+${artifactPath.replaceAll(".", "\\.")}\\s*$`, "m"));
  }
  assert.match(workflow, /validation_runner_token="\$ACP_VALIDATION_RUN_TOKEN"\n\s+unset ACP_VALIDATION_RUN_TOKEN/);
  assert.match(workflow, /ACP_VALIDATION_RUN_TOKEN="\$validation_runner_token" node scripts\/r2\.8-multi-room-dialogue\.mjs/);
  assert.match(workflow, /ACP_VALIDATION_RUN_TOKEN="\$validation_runner_token" node scripts\/r2\.8\.4-llm-language-corpus\.mjs/);
  assert.doesNotMatch(workflow, /env\s+ACP_VALIDATION_RUN_TOKEN=/);
});
