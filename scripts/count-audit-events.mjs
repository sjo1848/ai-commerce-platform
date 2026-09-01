#!/usr/bin/env node

import fs from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("usage: count-audit-events.mjs <wrangler-tail-log>");
const raw = fs.readFileSync(path, "utf8");
const events = [];

function inspect(value) {
  if (Array.isArray(value)) {
    for (const item of value) inspect(item);
    return;
  }
  if (value && typeof value === "object") {
    if (value.kind === "audit_event") events.push(value);
    for (const nested of Object.values(value)) inspect(nested);
    return;
  }
  if (typeof value !== "string") return;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return;
  try { inspect(JSON.parse(text)); } catch { /* ordinary log text */ }
}

for (const line of raw.split(/\r?\n/)) {
  const text = line.trim();
  if (!text) continue;
  try { inspect(JSON.parse(text)); } catch { /* concatenated or pretty output */ }
}
try { inspect(JSON.parse(raw)); } catch { /* expected */ }

const unique = new Map();
for (const event of events) {
  const key = [event.requestId, event.sessionId, event.toolId, event.status, event.detail ?? ""].join("|");
  unique.set(key, event);
}
const values = [...unique.values()];
const countsByStatus = {};
const countsByTool = {};
for (const event of values) {
  countsByStatus[event.status] = (countsByStatus[event.status] ?? 0) + 1;
  countsByTool[event.toolId] = (countsByTool[event.toolId] ?? 0) + 1;
}

process.stdout.write(JSON.stringify({
  auditEvents: values.length,
  countsByStatus,
  countsByTool,
  events: values,
}));
