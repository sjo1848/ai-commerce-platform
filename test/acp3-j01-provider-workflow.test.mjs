import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/acp3-j01-provider-preflight.yml", import.meta.url), "utf8");

test("ACP-3 J01 provider workflow is manual, exact-SHA and explicit-authorization only", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /candidate_sha:/);
  assert.match(workflow, /authorization:/);
  assert.match(workflow, /I_AUTHORIZE_ONE_ACP3_J01_PROVIDER_PREFLIGHT/);
  assert.match(workflow, /test "\$REQUESTED_SHA" = "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow, /\npush:/);
  assert.doesNotMatch(workflow, /schedule:/);
});

test("ACP-3 J01 provider workflow uploads candidate without direct deploy and uses zero-percent override-only routing", () => {
  assert.match(workflow, /wrangler versions upload/);
  assert.match(workflow, /"\$PRIOR_VERSION_ID@100%"/);
  assert.match(workflow, /"\$CANDIDATE_VERSION_ID@0%"/);
  assert.match(workflow, /Cloudflare-Workers-Version-Overrides/);
  assert.doesNotMatch(workflow, /wrangler deploy(?:\s|\\)/);
  assert.doesNotMatch(workflow, /staging-e2e-reservation/);
  assert.doesNotMatch(workflow, /createReservation|cancelReservation|createMultiReservation|cancelMultiReservation/);
  assert.doesNotMatch(workflow, /\/api\/chat/);
});

test("ACP-3 J01 provider workflow executes only the isolated empty-body semantic preflight route", () => {
  assert.match(workflow, /PREFLIGHT_PATH: \/__validation\/acp3\/j01-provider-preflight/);
  const executionStep = workflow.indexOf("Execute exactly one budgeted ACP-3 semantic preflight");
  assert.ok(executionStep > 0);
  const after = workflow.slice(executionStep);
  const preRestore = after.slice(0, after.indexOf("Restore exact prior deployment"));
  const curlTargets = [...preRestore.matchAll(/\$AI_COMMERCE_STAGING_URL\$PREFLIGHT_PATH/g)];
  assert.equal(curlTargets.length, 1);
  assert.doesNotMatch(preRestore, /--data|--form|--upload-file/);
  assert.match(preRestore, /-X POST/);
  assert.match(preRestore, /operationalState/);
  assert.match(preRestore, /preparedOperation !== false/);
});

test("ACP-3 J01 provider workflow preserves sanitized RED evidence before asserting HTTP 200", () => {
  const executionStep = workflow.indexOf("Execute exactly one budgeted ACP-3 semantic preflight");
  const restoreStep = workflow.indexOf("Restore exact prior deployment", executionStep);
  assert.ok(executionStep > 0 && restoreStep > executionStep);
  const preflight = workflow.slice(executionStep, restoreStep);
  const summaryWrite = preflight.indexOf('writeFileSync("/tmp/acp3-j01-preflight-summary.json"');
  const statusAssertion = preflight.indexOf('if (process.env.PREFLIGHT_STATUS !== "200")');
  assert.ok(summaryWrite > 0, "preflight must write a sanitized summary");
  assert.ok(statusAssertion > summaryWrite, "summary must be written before PASS assertions can throw");
  assert.match(preflight, /ACP3_J01_PROVIDER_PREFLIGHT_RESPONSE/);
  assert.match(preflight, /responseParse: "INVALID_JSON"/);
  assert.match(preflight, /safeFailureCode/);
  assert.match(preflight, /safeValidationMessage/);
  assert.match(preflight, /safeReceipt/);
  assert.match(preflight, /providerNeurons/);
  assert.doesNotMatch(preflight, /writeFileSync\("\/tmp\/acp3-j01-preflight-summary\.json",\s*raw/);

  const evidenceStep = workflow.slice(workflow.indexOf("Preserve sanitized preflight evidence"));
  assert.match(evidenceStep, /\/tmp\/acp3-j01-preflight-summary\.json/);
});

test("ACP-3 J01 provider workflow always restores the exact prior 100-percent deployment and removes local credentials", () => {
  assert.match(workflow, /- name: Restore exact prior deployment\n\s+if: always\(\)/);
  assert.match(workflow, /"\$PRIOR_VERSION_ID@100%"/);
  assert.match(workflow, /versions\.length !== 1/);
  assert.match(workflow, /versions\[0\]\?\.percentage !== 100/);
  assert.match(workflow, /- name: Remove sensitive temporary files\n\s+if: always\(\)/);
  assert.match(workflow, /rm -f "\$\{ACP3_TOKEN_FILE:-\}" "\$\{ACP3_SECRETS_FILE:-\}" "\$\{ACP3_CURL_CONFIG:-\}"/);
});

test("ACP-3 J01 provider workflow retains the existing bounded durable validation budget", () => {
  assert.match(workflow, /maxNeuronsPerRun: 7000/);
  assert.match(workflow, /configuredAvailableBudget: 7000/);
  assert.match(workflow, /configuredReserve: 0/);
  assert.match(workflow, /conservativeExpectedCost: 180/);
  assert.match(workflow, /ACP_VALIDATION_EXPERIMENT_ID/);
  assert.match(workflow, /ACP_VALIDATION_RUN_TOKEN/);
});
