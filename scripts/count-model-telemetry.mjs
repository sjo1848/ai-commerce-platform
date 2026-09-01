#!/usr/bin/env node

import fs from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("usage: count-model-telemetry.mjs <wrangler-tail-log>");
const raw = fs.readFileSync(path, "utf8");

let modelInferences = 0;
let modelFallbacks = 0;
const inferences = [];
const fallbacks = [];

function inspect(value) {
  if (Array.isArray(value)) {
    for (const item of value) inspect(item);
    return;
  }
  if (value && typeof value === "object") {
    if (value.kind === "model_inference") {
      modelInferences += 1;
      inferences.push(value);
    } else if (value.kind === "model_fallback") {
      modelFallbacks += 1;
      fallbacks.push(value);
    }
    for (const nested of Object.values(value)) inspect(nested);
    return;
  }
  if (typeof value !== "string") return;

  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return;
  try { inspect(JSON.parse(text)); } catch { /* ordinary log string */ }
}

for (const line of raw.split(/\r?\n/)) {
  const text = line.trim();
  if (!text) continue;
  try { inspect(JSON.parse(text)); }
  catch { /* Wrangler can pretty-print multi-line JSON; complete-file pass follows. */ }
}

try { inspect(JSON.parse(raw)); } catch { /* expected for concatenated tail events */ }

function inferenceKey(item) {
  return [item.logId, item.sessionId, item.label, item.model, item.inputTokens, item.outputTokens, item.latencyMs].join("|");
}
function fallbackKey(item) {
  return [item.sessionId, item.label, item.fallbackReason, item.timestamp].join("|");
}

const uniqueInferenceMap = new Map();
for (const item of inferences) uniqueInferenceMap.set(inferenceKey(item), item);
const uniqueFallbackMap = new Map();
for (const item of fallbacks) uniqueFallbackMap.set(fallbackKey(item), item);
const uniqueInferences = [...uniqueInferenceMap.values()];
const uniqueFallbacks = [...uniqueFallbackMap.values()];
modelInferences = uniqueInferences.length;
modelFallbacks = uniqueFallbacks.length;

function numbers(items, key) {
  return items.map((item) => item[key]).filter((value) => typeof value === "number" && Number.isFinite(value));
}
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index];
}

const latencies = numbers(uniqueInferences, "latencyMs");
const inputTokens = numbers(uniqueInferences, "inputTokens");
const outputTokens = numbers(uniqueInferences, "outputTokens");
const costs = numbers(uniqueInferences, "estimatedCostUsd");
const models = [...new Set(uniqueInferences.map((item) => item.model).filter(Boolean))];
const fallbackReasons = {};
for (const item of uniqueFallbacks) {
  const reason = typeof item.fallbackReason === "string" ? item.fallbackReason : "UNKNOWN";
  fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1;
}

process.stdout.write(JSON.stringify({
  modelInferences,
  modelFallbacks,
  fallbackRatio: modelInferences + modelFallbacks > 0 ? modelFallbacks / (modelInferences + modelFallbacks) : 0,
  models,
  totalInputTokens: sum(inputTokens),
  totalOutputTokens: sum(outputTokens),
  estimatedCostUsd: sum(costs),
  latencyMs: {
    min: latencies.length ? Math.min(...latencies) : null,
    median: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.length ? Math.max(...latencies) : null,
  },
  fallbackReasons,
  inferences: uniqueInferences,
  fallbacks: uniqueFallbacks,
}));
