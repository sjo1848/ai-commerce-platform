import assert from "node:assert/strict";
import test from "node:test";
import { redactValidationTail } from "../scripts/redact-validation-tail.mjs";

test("redacts case-insensitive quoted validation headers while preserving JSON telemetry", () => {
  const source = '{"headers":{"X-Acp-Validation-Run-Token":"quoted-secret","other":"kept"},"kind":"model_inference"}';
  const result = redactValidationTail(source);

  assert.equal(result.includes("quoted-secret"), false);
  assert.deepEqual(JSON.parse(result), {
    headers: { "X-Acp-Validation-Run-Token": "[REDACTED]", other: "kept" },
    kind: "model_inference",
  });
});

test("redacts unquoted and single-quoted JSON-ish validation header forms", () => {
  const source = "x-acp-validation-run-token: bare-secret\n{'x-acp-validation-run-token': 'single-quoted-secret', kind: 'audit_event'}";
  const result = redactValidationTail(source);

  assert.equal(result.includes("bare-secret"), false);
  assert.equal(result.includes("single-quoted-secret"), false);
  assert.match(result, /x-acp-validation-run-token: "\[REDACTED\]"/i);
  assert.match(result, /'x-acp-validation-run-token': "\[REDACTED\]"/i);
});

test("redaction is idempotent", () => {
  const source = '{"x-acp-validation-run-token":"secret"}';
  const once = redactValidationTail(source);

  assert.equal(redactValidationTail(once), once);
});
