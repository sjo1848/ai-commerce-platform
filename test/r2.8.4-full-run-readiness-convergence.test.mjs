import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { proveFullRunReadiness } from "../scripts/r2.8-full-run-readiness.mjs";

const versionId = "12345678-1234-1234-1234-123456789abc";
const workflow = readFileSync(new URL("../.github/workflows/r2.8-multi-room-dialogue.yml", import.meta.url), "utf8");
const readinessScript = readFileSync(new URL("../scripts/r2.8-full-run-readiness.mjs", import.meta.url), "utf8");

function response(status, runtimeVersionId) {
  return new Response(null, { status, headers: runtimeVersionId ? { "x-acp-validation-runtime-version": runtimeVersionId } : {} });
}

async function run(sequence) {
  const requests = [];
  const sleeps = [];
  const proof = await proveFullRunReadiness({
    url: "https://example.test/",
    versionId,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return sequence.shift();
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  });
  return { proof, requests, sleeps };
}

test("full-run readiness retries a transient 200 then accepts exact 403 runtime identity", async () => {
  const { proof, requests, sleeps } = await run([response(200), response(403, versionId)]);
  assert.equal(proof.attempt, 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ url, options }) => [url, options.method]), [["https://example.test/", "GET"], ["https://example.test/", "GET"]]);
  assert.equal(requests.every(({ options }) => options.redirect === "manual"), true);
  assert.deepEqual(sleeps, [1_000]);
});

test("full-run readiness tolerates several transient responses but stops at the fourth valid attempt", async () => {
  const { proof, requests, sleeps } = await run([response(200), response(404), response(500), response(403, versionId)]);
  assert.equal(proof.attempt, 4);
  assert.equal(requests.length, 4);
  assert.deepEqual(sleeps, [1_000, 1_000, 1_000]);
});

test("full-run readiness fails closed after exactly four invalid responses", async () => {
  let calls = 0;
  let sleeps = 0;
  await assert.rejects(
    proveFullRunReadiness({
      url: "https://example.test/",
      versionId,
      fetchImpl: async () => { calls += 1; return response(200); },
      sleep: async () => { sleeps += 1; },
    }),
    /did not converge after 4 GET attempts/,
  );
  assert.equal(calls, 4);
  assert.equal(sleeps, 3);
});

test("missing or wrong runtime identity never proceeds; only a valid response does", async () => {
  const { proof, requests } = await run([response(403), response(403, "wrong-version"), response(403, versionId)]);
  assert.equal(proof.attempt, 3);
  assert.equal(proof.runtimeVersionId, versionId);
  assert.equal(requests.length, 3);
});

test("full-run workflow gates all runners behind bounded read-only readiness", () => {
  const readinessStart = workflow.indexOf("- name: Prove full RUN 1 readiness response before provider runner");
  const readinessEnd = workflow.indexOf("- name: Prove foreground tail and unauthenticated observability probe");
  const runnerStart = workflow.indexOf("- name: Real-model natural multi-room dialogue");
  const readiness = workflow.slice(readinessStart, readinessEnd);
  assert.match(readiness, /R28_READINESS_URL=.*R28_VERSION_ID=.*node scripts\/r2\.8-full-run-readiness\.mjs/);
  assert.doesNotMatch(readiness, /wrangler tail|api\/chat|api\/approve|hms\.|r2\.8-multi-room-dialogue|r2\.8\.4-llm-language-corpus/);
  assert.equal(readinessStart < readinessEnd && readinessEnd < runnerStart, true);
  assert.match(readinessScript, /const MAX_ATTEMPTS = 4/);
  assert.match(readinessScript, /method: "GET", redirect: "manual"/);
  assert.match(readinessScript, /response\.status === 403 && observedVersionId === versionId/);
});
