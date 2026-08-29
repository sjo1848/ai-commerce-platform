import test from "node:test";
import assert from "node:assert/strict";
import { CoreError } from "../dist/core/errors.js";
import { ToolRegistry } from "../dist/core/tool-registry.js";
import { PolicyEngine } from "../dist/core/policy.js";
import { AgentCoreExecutor } from "../dist/core/executor.js";
import { InMemoryAuditSink } from "../dist/core/audit.js";
import { InMemoryUsageSink } from "../dist/core/usage.js";
import { InMemoryIdempotencyStore } from "../dist/core/idempotency.js";
import { runtime, tenantA, tenantB, actor } from "./helpers.mjs";

test("tenant resolver rejects unknown and suspended tenants", () => {
  const r = runtime();
  assert.throws(() => r.tenantResolver.resolve("missing"), (e) => e instanceof CoreError && e.code === "TENANT_NOT_FOUND");
});

test("session is tenant-bound and cannot be replayed across tenants", () => {
  const r = runtime();
  const a = r.createContext({ tenantId: tenantA.id, actor, channel: "webchat" });
  assert.throws(() => r.createContext({ tenantId: tenantB.id, actor, channel: "webchat", sessionId: a.session.id }), (e) => e instanceof CoreError && e.code === "TENANT_MISMATCH");
});

test("tool registry exposes only tenant-enabled tools", () => {
  const r = runtime();
  assert.deepEqual(r.registry.descriptorsFor(tenantA).map((t) => t.id).sort(), ["hms.checkAvailability", "hms.getQuote"]);
  assert.deepEqual(r.registry.descriptorsFor(tenantB), []);
});

test("policy denies missing permission", async () => {
  const r = runtime();
  const noPerm = { ...actor, permissions: [] };
  const ctx = r.createContext({ tenantId: tenantA.id, actor: noPerm, channel: "webchat" });
  await assert.rejects(() => r.executor.execute("hms.checkAvailability", { checkIn: "2026-09-01", checkOut: "2026-09-02", guests: 1 }, ctx), (e) => e instanceof CoreError && e.code === "TOOL_NOT_ALLOWED");
});

test("policy requires approval for financial/admin/irreversible tools", async () => {
  const registry = new ToolRegistry();
  registry.register({
    id: "test.financial",
    primitive: "PAY",
    description: "financial test",
    risk: "financial",
    sideEffect: "reversible",
    requiredPermissions: ["pay"],
    validateInput: (input) => ({ ok: true, value: input }),
    execute: async (input) => input,
  });
  const audit = new InMemoryAuditSink();
  const executor = new AgentCoreExecutor(registry, new PolicyEngine(), audit, new InMemoryUsageSink(), new InMemoryIdempotencyStore());
  const r = runtime();
  const ctx0 = r.createContext({ tenantId: tenantA.id, actor: { ...actor, permissions: ["pay"] }, channel: "webchat" });
  const ctx = { ...ctx0, tenant: { ...tenantA, allowedToolIds: ["test.financial"] } };
  await assert.rejects(() => executor.execute("test.financial", {}, ctx, { idempotencyKey: "x" }), (e) => e instanceof CoreError && e.code === "APPROVAL_REQUIRED");
});

test("duplicate tool ids are rejected at registration", () => {
  const registry = new ToolRegistry();
  const tool = { id: "same", primitive: "CHECK", description: "same", risk: "read", sideEffect: "none", requiredPermissions: [], validateInput: (x) => ({ ok: true, value: x }), execute: async (x) => x };
  registry.register(tool);
  assert.throws(() => registry.register(tool), /Duplicate tool/);
});
