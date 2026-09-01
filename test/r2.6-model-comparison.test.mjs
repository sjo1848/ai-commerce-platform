import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve("scripts/r2.6-compare-reports.mjs");

function evalReport(expectedModel, median = 3000, p95 = 7000) {
  return {
    expectedModel,
    summary: {
      hardCategoriesPass: true,
      qualityPass: true,
      receptionistQualityProxy: 1,
      endToEndLatencyMs: { median, p95 },
    },
  };
}

function telemetry(model, { cost = 0.01, median = 1200, p95 = 2500, fallbackRatio = 0 } = {}) {
  return {
    models: [model],
    modelInferences: 12,
    modelFallbacks: 0,
    fallbackRatio,
    totalInputTokens: 10000,
    totalOutputTokens: 1000,
    estimatedCostUsd: cost,
    latencyMs: { median, p95 },
  };
}

function runComparison({ baselineEval, baselineTelemetry, candidateEval, candidateTelemetry }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-6-compare-"));
  const files = [baselineEval, baselineTelemetry, candidateEval, candidateTelemetry].map((value, index) => {
    const file = path.join(dir, `${index}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  });
  try {
    const output = execFileSync(process.execPath, [script, ...files], { encoding: "utf8" });
    return JSON.parse(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const baselineModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const candidateModel = "@cf/openai/gpt-oss-20b";

test("R2.6 comparison requires telemetry to match each explicitly deployed model", () => {
  const result = runComparison({
    baselineEval: evalReport(baselineModel),
    baselineTelemetry: telemetry(baselineModel, { cost: 0.02 }),
    candidateEval: evalReport(candidateModel, 2800, 6500),
    candidateTelemetry: telemetry(candidateModel, { cost: 0.005 }),
  });
  assert.equal(result.baseline.modelIdentityMatches, true);
  assert.equal(result.candidate.modelIdentityMatches, true);
  assert.equal(result.decision, "SWITCH_MODEL");
});

test("R2.6 never selects a candidate when its observed telemetry is from another model", () => {
  const result = runComparison({
    baselineEval: evalReport(baselineModel),
    baselineTelemetry: telemetry(baselineModel, { cost: 0.02 }),
    candidateEval: evalReport(candidateModel, 2500, 6000),
    candidateTelemetry: telemetry(baselineModel, { cost: 0.001 }),
  });
  assert.equal(result.candidate.modelIdentityMatches, false);
  assert.equal(result.candidate.eligible, false);
  assert.equal(result.decision, "RETAIN_BASELINE");
});

test("R2.6 fails closed when baseline telemetry does not match the deployed baseline", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-6-compare-fail-"));
  const payloads = [
    evalReport(baselineModel),
    telemetry(candidateModel, { cost: 0.02 }),
    evalReport(candidateModel),
    telemetry(candidateModel, { cost: 0.005 }),
  ];
  const files = payloads.map((value, index) => {
    const file = path.join(dir, `${index}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  });
  try {
    const result = spawnSync(process.execPath, [script, ...files], { encoding: "utf8" });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.baseline.modelIdentityMatches, false);
    assert.equal(report.decision, "REWORK");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
