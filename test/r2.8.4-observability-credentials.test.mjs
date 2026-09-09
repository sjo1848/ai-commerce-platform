import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const helper = "scripts/query-workers-observability.mjs";
const workflow = readFileSync(new URL("../.github/workflows/r2.8-multi-room-dialogue.yml", import.meta.url), "utf8");

function runHelper(env, mockSource = "") {
  const dir = mkdtempSync(join(tmpdir(), "r284-observability-"));
  try {
    const mock = join(dir, "mock.mjs");
    writeFileSync(mock, mockSource);
    return { result: spawnSync(process.execPath, ["--import", mock, helper, "10", "20"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...env },
    }), dir };
  } finally {
    // The successful mock writes its assertion result before the child exits.
  }
}

test("observability helper requires the dedicated credential and never falls back to deployment token", () => {
  const { result, dir } = runHelper({
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "deployment-token-only",
    WORKER_NAME: "worker",
  }, "globalThis.fetch = async () => { throw new Error('network must not be called'); };");
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLOUDFLARE_OBSERVABILITY_API_TOKEN/);
    assert.doesNotMatch(result.stderr, /deployment-token-only/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("observability helper uses only the dedicated credential for its mocked request", () => {
  const dir = mkdtempSync(join(tmpdir(), "r284-observability-request-"));
  const capture = join(dir, "capture.json");
  const mock = join(dir, "mock.mjs");
  writeFileSync(mock, `import { writeFileSync } from "node:fs"; globalThis.fetch = async (_url, options) => { writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ authorization: options.headers.Authorization })); return { ok: true, status: 200, text: async () => '{"success":true}' }; };`);
  try {
    const result = spawnSync(process.execPath, ["--import", mock, helper, "10", "20"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "deployment-token", CLOUDFLARE_OBSERVABILITY_API_TOKEN: "observability-token", WORKER_NAME: "worker" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(capture, "utf8"), '{"authorization":"Bearer observability-token"}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("observability helper retains sanitized 403 metadata with the dedicated credential", () => {
  const { result, dir } = runHelper({
    CLOUDFLARE_ACCOUNT_ID: "account-secret",
    CLOUDFLARE_OBSERVABILITY_API_TOKEN: "observability-secret",
    WORKER_NAME: "worker",
  }, `globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ success: false, errors: [{ code: 10000, message: "Bearer observability-secret for account-secret", documentation_url: "https://example.invalid/account-secret" }] }) });`);
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /"status":403/);
    assert.match(result.stderr, /documentation_url/);
    assert.doesNotMatch(result.stderr, /observability-secret|account-secret/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflow isolates observability credentials from validation and provider responsibilities", () => {
  const validationJobStart = workflow.indexOf("  validation-admission:");
  const dialogueJobStart = workflow.indexOf("  dialogue:");
  const historicalJob = workflow.slice(workflow.indexOf("  historical-observability:"), validationJobStart);
  const validationJob = workflow.slice(validationJobStart, dialogueJobStart);
  const dialogueJob = workflow.slice(dialogueJobStart, workflow.indexOf("    steps:", dialogueJobStart));
  assert.match(historicalJob, /CLOUDFLARE_OBSERVABILITY_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_OBSERVABILITY_API_TOKEN \}\}/);
  assert.match(historicalJob, /query-workers-observability\.mjs/);
  assert.doesNotMatch(historicalJob, /wrangler tail|curl|r2\.8-multi-room-dialogue|r2\.8\.4-llm-language-corpus/);
  assert.match(validationJob, /mode == 'validation-admission-only'/);
  assert.match(validationJob, /CLOUDFLARE_OBSERVABILITY_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_OBSERVABILITY_API_TOKEN \}\}/);
  assert.match(validationJob, /node scripts\/query-workers-observability\.mjs/);
  assert.doesNotMatch(validationJob, /r2\.8-multi-room-dialogue\.mjs|r2\.8\.4-llm-language-corpus\.mjs|api\/chat|api\/approve/);
  assert.doesNotMatch(dialogueJob, /CLOUDFLARE_OBSERVABILITY_API_TOKEN/);
  assert.match(dialogueJob, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.equal((workflow.match(/CLOUDFLARE_OBSERVABILITY_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_OBSERVABILITY_API_TOKEN \}\}/g) ?? []).length, 5);
  assert.equal(workflow.split('test -n "${CLOUDFLARE_OBSERVABILITY_API_TOKEN//[[:space:]]/}"').length - 1, 3);
  const tailProbe = workflow.slice(workflow.indexOf("- name: Prove foreground tail"), workflow.indexOf("- name: Historical observability preflight query"));
  const preflight = workflow.slice(workflow.indexOf("- name: Historical observability preflight query"), workflow.indexOf("- name: Real-model natural multi-room dialogue"));
  const dialogue = workflow.slice(workflow.indexOf("- name: Real-model natural multi-room dialogue"), workflow.indexOf("- name: Verify exact active deployment after corpus"));
  const broadEvidence = workflow.slice(workflow.indexOf("- name: Preserve broad historical evidence"), workflow.indexOf("- name: Remove remotely deployed validation configuration"));
  assert.match(tailProbe, /\.\/node_modules\/\.bin\/wrangler tail/);
  assert.match(tailProbe, /curl -sS/);
  assert.doesNotMatch(tailProbe, /CLOUDFLARE_OBSERVABILITY_API_TOKEN|query-workers-observability/);
  assert.match(preflight, /node scripts\/query-workers-observability\.mjs/);
  assert.match(preflight, /test -n "\$\{R28_EVIDENCE_FROM_MS:-\}"/);
  assert.doesNotMatch(preflight, /wrangler|curl|r2\.8-multi-room-dialogue|r2\.8\.4-llm-language-corpus/);
  assert.match(broadEvidence, /node scripts\/query-workers-observability\.mjs/);
  assert.doesNotMatch(preflight, /ACP_VALIDATION_RUN_TOKEN/);
  assert.match(dialogue, /ACP_VALIDATION_RUN_TOKEN/);
  assert.doesNotMatch(dialogue, /CLOUDFLARE_OBSERVABILITY_API_TOKEN/);
  for (const source of [
    "scripts/r2.8-multi-room-dialogue.mjs",
    "scripts/r2.8.4-llm-language-corpus.mjs",
    "scripts/validation-request-headers.mjs",
  ]) {
    assert.doesNotMatch(readFileSync(source, "utf8"), /CLOUDFLARE_OBSERVABILITY_API_TOKEN/);
  }
  const observabilitySteps = workflow
    .split(/^      - name: /m)
    .filter((step) => step.includes("CLOUDFLARE_OBSERVABILITY_API_TOKEN"));
  assert.equal(observabilitySteps.length, 6);
  const querySteps = observabilitySteps.filter((step) => step.includes("query-workers-observability.mjs"));
  assert.equal(querySteps.length, 4);
  for (const step of querySteps) {
    assert.match(step, /query-workers-observability\.mjs/);
    assert.doesNotMatch(step, /r2\.8-multi-room-dialogue|r2\.8\.4-llm-language-corpus/);
    if (step.includes("Capture both-method zero-inference runtime identity proof")) assert.match(step, /wrangler tail/);
    else assert.doesNotMatch(step, /wrangler tail/);
  }
});

test("helper source excludes the deployment credential name", () => {
  const source = readFileSync(new URL("../scripts/query-workers-observability.mjs", import.meta.url), "utf8");
  assert.match(source, /CLOUDFLARE_OBSERVABILITY_API_TOKEN/);
  assert.doesNotMatch(source, /CLOUDFLARE_API_TOKEN/);
});
