#!/usr/bin/env node

import fs from "node:fs";

const [baselineEvalPath, baselineTelemetryPath, candidateEvalPath, candidateTelemetryPath] = process.argv.slice(2);
if (!candidateTelemetryPath) {
  throw new Error("usage: r2.6-compare-reports.mjs <baseline-eval> <baseline-telemetry> <candidate-eval> <candidate-telemetry>");
}

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const baselineEval = read(baselineEvalPath);
const baselineTelemetry = read(baselineTelemetryPath);
const candidateEval = read(candidateEvalPath);
const candidateTelemetry = read(candidateTelemetryPath);

function modelIdentityMatches(evalReport, telemetry) {
  const expectedModel = evalReport?.expectedModel;
  const observedModels = telemetry?.models;
  return typeof expectedModel === "string"
    && expectedModel.length > 0
    && Array.isArray(observedModels)
    && observedModels.length === 1
    && observedModels[0] === expectedModel;
}

function eligible(evalReport, telemetry) {
  const e2eP95 = evalReport?.summary?.endToEndLatencyMs?.p95;
  const providerP95 = telemetry?.latencyMs?.p95;
  const fallbackRatio = telemetry?.fallbackRatio;
  const inferenceCount = telemetry?.modelInferences;
  return Boolean(
    modelIdentityMatches(evalReport, telemetry)
    && evalReport?.summary?.hardCategoriesPass
    && evalReport?.summary?.qualityPass
    && evalReport?.summary?.receptionistQualityProxy >= 0.9
    && typeof e2eP95 === "number" && e2eP95 <= 10_000
    && typeof providerP95 === "number" && providerP95 < 8_000
    && typeof fallbackRatio === "number" && fallbackRatio <= 0.10
    && typeof inferenceCount === "number" && inferenceCount >= 3
  );
}

const baselineModelIdentityMatches = modelIdentityMatches(baselineEval, baselineTelemetry);
const candidateModelIdentityMatches = modelIdentityMatches(candidateEval, candidateTelemetry);
const baselineEligible = eligible(baselineEval, baselineTelemetry);
const candidateEligible = eligible(candidateEval, candidateTelemetry);
const baselineQuality = baselineEval?.summary?.receptionistQualityProxy ?? 0;
const candidateQuality = candidateEval?.summary?.receptionistQualityProxy ?? 0;
const baselineMedian = baselineEval?.summary?.endToEndLatencyMs?.median;
const candidateMedian = candidateEval?.summary?.endToEndLatencyMs?.median;
const baselineCost = baselineTelemetry?.estimatedCostUsd;
const candidateCost = candidateTelemetry?.estimatedCostUsd;

const qualityWithinTolerance = candidateQuality >= baselineQuality - 0.05;
const fallbackNotWorse = candidateTelemetry.fallbackRatio <= baselineTelemetry.fallbackRatio;
const latencyWithinTolerance = typeof baselineMedian === "number" && typeof candidateMedian === "number"
  ? candidateMedian <= baselineMedian * 1.25
  : false;
const costGain = typeof baselineCost === "number" && baselineCost > 0 && typeof candidateCost === "number"
  ? 1 - (candidateCost / baselineCost)
  : 0;
const latencyGain = typeof baselineMedian === "number" && baselineMedian > 0 && typeof candidateMedian === "number"
  ? 1 - (candidateMedian / baselineMedian)
  : 0;
const materialEfficiencyGain = costGain >= 0.25 || latencyGain >= 0.20;

let decision;
let reason;
if (!baselineEligible) {
  decision = "REWORK";
  reason = baselineModelIdentityMatches
    ? "baseline failed one or more R2.6 hard gates"
    : "baseline telemetry did not match the explicitly deployed baseline model";
} else if (!candidateEligible) {
  decision = "RETAIN_BASELINE";
  reason = candidateModelIdentityMatches
    ? "candidate failed one or more R2.6 hard gates"
    : "candidate telemetry did not match the explicitly deployed candidate model";
} else if (!qualityWithinTolerance || !fallbackNotWorse || !latencyWithinTolerance || !materialEfficiencyGain) {
  decision = "RETAIN_BASELINE";
  reason = "candidate passed hard gates but did not satisfy the bounded replacement rule";
} else {
  decision = "SWITCH_MODEL";
  reason = "candidate passed hard gates and delivered a material efficiency gain without unacceptable quality/fallback/latency regression";
}

const report = {
  version: "ACP-2.6.9-R2.6-comparison-v2",
  decision,
  reason,
  baseline: {
    expectedModel: baselineEval?.expectedModel ?? null,
    observedModels: baselineTelemetry.models,
    modelIdentityMatches: baselineModelIdentityMatches,
    eligible: baselineEligible,
    receptionistQualityProxy: baselineQuality,
    fallbackRatio: baselineTelemetry.fallbackRatio,
    endToEndMedianMs: baselineMedian,
    providerP95Ms: baselineTelemetry.latencyMs?.p95,
    estimatedCostUsd: baselineCost,
    inputTokens: baselineTelemetry.totalInputTokens,
    outputTokens: baselineTelemetry.totalOutputTokens,
  },
  candidate: {
    expectedModel: candidateEval?.expectedModel ?? null,
    observedModels: candidateTelemetry.models,
    modelIdentityMatches: candidateModelIdentityMatches,
    eligible: candidateEligible,
    receptionistQualityProxy: candidateQuality,
    fallbackRatio: candidateTelemetry.fallbackRatio,
    endToEndMedianMs: candidateMedian,
    providerP95Ms: candidateTelemetry.latencyMs?.p95,
    estimatedCostUsd: candidateCost,
    inputTokens: candidateTelemetry.totalInputTokens,
    outputTokens: candidateTelemetry.totalOutputTokens,
  },
  deltas: {
    costReductionRatio: costGain,
    medianLatencyReductionRatio: latencyGain,
    qualityDelta: candidateQuality - baselineQuality,
  },
  replacementChecks: {
    baselineModelIdentityMatches,
    candidateModelIdentityMatches,
    qualityWithinTolerance,
    fallbackNotWorse,
    latencyWithinTolerance,
    materialEfficiencyGain,
  },
};

console.log(JSON.stringify(report, null, 2));
if (decision === "REWORK") process.exit(1);
