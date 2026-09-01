import test from "node:test";
import assert from "node:assert/strict";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { ConsoleAuditSink } from "../dist/core/audit.js";

const tenant = {
  id: "hotel-a",
  slug: "hotel-a",
  status: "active",
  allowedToolIds: [],
};

test("runtime accepts an explicit audit sink for staging observability", () => {
  const events = [];
  const sink = { record(event) { events.push(event); } };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], auditSink: sink });
  assert.equal(runtime.audit, sink);
});

test("ConsoleAuditSink emits structured audit_event JSON", () => {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    const sink = new ConsoleAuditSink();
    sink.record({
      timestamp: "2026-09-01T13:00:00.000Z",
      requestId: "req-r28",
      tenantId: "hotel-a",
      actorId: "actor-a",
      sessionId: "session-a",
      toolId: "hms.checkAvailability",
      status: "succeeded",
    });
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.kind, "audit_event");
  assert.equal(event.toolId, "hms.checkAvailability");
  assert.equal(event.status, "succeeded");
});
