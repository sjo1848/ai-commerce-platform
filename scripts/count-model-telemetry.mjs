#!/usr/bin/env node

import fs from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("usage: count-model-telemetry.mjs <wrangler-tail-log>");
const raw = fs.readFileSync(path, "utf8");

let modelInferences = 0;
let modelFallbacks = 0;
const inferences = [];

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
    }
    for (const nested of Object.values(value)) inspect(nested);
    return;
  }
  if (typeof value !== "string") return;

  // Wrangler tail embeds console.log JSON as escaped strings inside its own JSON.
  // Parse those strings recursively instead of depending on raw grep escaping.
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return;
  try { inspect(JSON.parse(text)); } catch { /* ordinary log string */ }
}

for (const line of raw.split(/\r?\n/)) {
  const text = line.trim();
  if (!text) continue;
  try { inspect(JSON.parse(text)); }
  catch {
    // Some Wrangler versions pretty-print a multi-line JSON object. The complete
    // file is handled below as a second pass when possible.
  }
}

try { inspect(JSON.parse(raw)); } catch { /* expected for concatenated tail events */ }

// Deduplicate the second-pass possibility by stable telemetry identity.
const unique = new Map();
for (const item of inferences) {
  const key = [item.logId, item.label, item.model, item.inputTokens, item.outputTokens, item.latencyMs].join("|");
  unique.set(key, item);
}
if (unique.size && unique.size < modelInferences) modelInferences = unique.size;

const estimatedCostUsd = [...unique.values()].reduce(
  (sum, item) => sum + (typeof item.estimatedCostUsd === "number" ? item.estimatedCostUsd : 0),
  0,
);

process.stdout.write(JSON.stringify({
  modelInferences,
  modelFallbacks,
  estimatedCostUsd,
  inferences: [...unique.values()],
}));
