#!/usr/bin/env node

import fs from "node:fs";
import { completeTailEvents, telemetry } from "./r2.8-validation-turn-proof.mjs";

const path = process.argv[2];
if (!path) throw new Error("usage: count-audit-events.mjs <wrangler-tail-log>");
const raw = fs.readFileSync(path, "utf8");
const events = [];

for (const envelope of completeTailEvents(raw)) {
  if (process.env.R28_VERSION_ID && envelope.scriptVersion?.id !== process.env.R28_VERSION_ID) {
    throw new Error("CAPTURED_INVALID: Worker Version mismatch");
  }
  for (const event of telemetry(envelope)) if (event.kind === "audit_event") events.push(event);
}

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
