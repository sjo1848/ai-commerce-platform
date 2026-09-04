import test from "node:test";
import assert from "node:assert/strict";
import corpus from "./fixtures/r2.8.4-llm-language-corpus.json" with { type: "json" };
import { readFileSync } from "node:fs";
const llmSource = readFileSync(new URL("../src/core/llm-model.ts", import.meta.url), "utf8");

test("R2.8.4 LLM language corpus has bounded structured outcomes", () => {
  assert.equal(corpus.version, "ACP-2.6.9-R2.8.4-LLM-NLU-v1");
  assert.equal(corpus.cases.length, 15);
  assert.ok(corpus.cases.filter((item) => item.setupGuests !== undefined).every((item) => Number.isInteger(item.setupGuests) && item.setupGuests >= 1 && item.setupGuests <= 20));
  assert.match(llmSource, /Quantities explicitly attached to personas/); assert.match(llmSource, /For 'X en vez de Y'/);
  const runner = readFileSync(new URL("../scripts/r2.8.4-llm-language-corpus.mjs", import.meta.url), "utf8");
  assert.match(runner, /expected/); assert.match(runner, /Idempotency-Key/); assert.match(runner, /Reservá la selección actual/);
  assert.match(runner, /approvalSummary/); assert.match(runner, /approvalConsumed/); assert.match(runner, /authoritative/); assert.match(runner, /roomNumbers/); assert.match(runner, /setupValid/); assert.match(runner, /mutationSignals/); assert.match(runner, /initial/); assert.match(runner, /final/);
  assert.match(runner, /body\.outcome === "clarification"/); assert.match(runner, /body\.missing/); assert.match(runner, /typeof body\?\.message === "string"/); assert.match(runner, /uniqueMissing/); assert.match(runner, /approvalToken\|approvalSummary\|approvalTarget/); assert.match(runner, /observedOutcome/); assert.match(runner, /observedMissing/);
  assert.equal(/fetch\([^)]*\/api\/approve/.test(runner), false);
  const ids = new Set();
  for (const item of corpus.cases) {
    assert.match(item.id, /^L\d{2}$/); assert.equal(ids.has(item.id), false); ids.add(item.id);
    assert.equal(typeof item.category, "string"); assert.equal(typeof item.message, "string");
    assert.ok(item.expected && typeof item.expected === "object");
    const hasRooms = Array.isArray(item.expected.roomNumbers);
    const hasClarification = typeof item.expected.clarification === "string";
    assert.equal(hasRooms !== hasClarification, true);
    if (hasRooms) assert.ok(item.expected.roomNumbers.every((room) => /^\d{1,5}$/.test(room)));
    if (hasClarification) assert.equal(item.expected.clarification, "selection");
  }
});
