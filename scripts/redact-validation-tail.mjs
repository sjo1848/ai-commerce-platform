#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const VALIDATION_HEADER = "x-acp-validation-run-token";
const REDACTED_VALUE = '"[REDACTED]"';

// Preserve the key and delimiter while replacing a JSON string, a single-quoted
// value, or an unquoted header value. This deliberately does not need the token.
const validationHeaderValue = new RegExp(
  `((?:["']?${VALIDATION_HEADER}["']?)\\s*:\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^,\\s}\\]\\r\\n]+)`,
  "gi",
);

export function redactValidationTail(text) {
  return String(text).replace(validationHeaderValue, `$1${REDACTED_VALUE}`);
}

export function redactValidationTailFile(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const redacted = redactValidationTail(source);
  if (redacted !== source) writeFileSync(path, redacted);
  return redacted !== source;
}

if (import.meta.main) {
  if (process.argv.length < 3) throw new Error("usage: redact-validation-tail.mjs <tail-log> [...tail-log]");
  for (const path of process.argv.slice(2)) redactValidationTailFile(path);
}
