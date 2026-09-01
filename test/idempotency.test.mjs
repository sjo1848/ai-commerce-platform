import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../dist/core/tool-registry.js";
import { PolicyEngine } from "../dist/core/policy.js";
import { AgentCoreExecutor } from "../dist/core/executor.js";
import { InMemoryAuditSink } from "../dist/core/audit.js";
import { InMemoryUsageSink } from "../dist/core/usage.js";
import { InMemoryIdempotencyStore } from "../dist/core/idempotency.js";
import { CoreError } from "../dist/core/errors.js";
import { runtime, actor } from "./helpers.mjs";

async function setup() {
  let calls = 0;
  const registry = new ToolRegistry();
  registry.register({
    id: "test.write",
    primitive: "MODIFY",
    description: "write test",
    risk: "write",
    sideEffect: "reversible",
    requiredPermissions: ["write"],
    validateInput: (input) => typeof input === "object" && input !== null ? { ok: true, value: input } : { ok: false, message: "bad" },
    execute: async (input) => ({ calls: ++calls, input }),
  });
  const audit = new InMemoryAuditSink();
  const executor = new AgentCoreExecutor(registry, new PolicyEngine(), audit, new InMemoryUsageSink(), new InMemoryIdempotencyStore());
  const r = runtime();
  const ctx0 = await r.createContext({ tenantId: "hotel-a", actor: { ...actor, permissions: ["write"] }, channel: "webchat" });
  const ctx = { ...ctx0, tenant: { ...ctx0.tenant, allowedToolIds: ["test.write"] } };
  return { executor, ctx, audit, getCalls: () => calls };
}

test("side-effect tools require idempotency keys", async () => {
  const { executor, ctx } = await setup();
  await assert.rejects(() => executor.execute("test.write", { x: 1 }, ctx), (e) => e instanceof CoreError && e.code === "IDEMPOTENCY_REQUIRED");
});

test("same idempotency key replays result without duplicate side effect", async () => {
  const { executor, ctx, getCalls } = await setup();
  const a = await executor.execute("test.write", { x: 1 }, ctx, { idempotencyKey: "idem-1" });
  const b = await executor.execute("test.write", { x: 1 }, ctx, { idempotencyKey: "idem-1" });
  assert.deepEqual(a, b);
  assert.equal(getCalls(), 1);
});

test("same idempotency key with different payload conflicts", async () => {
  const { executor, ctx } = await setup();
  await executor.execute("test.write", { x: 1 }, ctx, { idempotencyKey: "idem-1" });
  await assert.rejects(() => executor.execute("test.write", { x: 2 }, ctx, { idempotencyKey: "idem-1" }), (e) => e instanceof CoreError && e.code === "IDEMPOTENCY_CONFLICT");
});

test("same client idempotency key is isolated between tenants", async () => {
  let calls = 0;
  const registry = new ToolRegistry();
  registry.register({
    id: "test.write",
    primitive: "MODIFY",
    description: "write test",
    risk: "write",
    sideEffect: "reversible",
    requiredPermissions: ["write"],
    validateInput: (input) => ({ ok: true, value: input }),
    execute: async (input, context) => ({ calls: ++calls, tenantId: context.tenant.id, input }),
  });
  const executor = new AgentCoreExecutor(registry, new PolicyEngine(), new InMemoryAuditSink(), new InMemoryUsageSink(), new InMemoryIdempotencyStore());
  const r = runtime();
  const baseA = await r.createContext({ tenantId: "hotel-a", actor: { ...actor, permissions: ["write"] }, channel: "webchat" });
  const baseB = await r.createContext({ tenantId: "hotel-b", actor: { ...actor, permissions: ["write"] }, channel: "webchat" });
  const ctxA = { ...baseA, tenant: { ...baseA.tenant, allowedToolIds: ["test.write"] } };
  const ctxB = { ...baseB, tenant: { ...baseB.tenant, allowedToolIds: ["test.write"] } };
  const a = await executor.execute("test.write", { x: 1 }, ctxA, { idempotencyKey: "same-key" });
  const b = await executor.execute("test.write", { x: 1 }, ctxB, { idempotencyKey: "same-key" });
  assert.equal(a.tenantId, "hotel-a");
  assert.equal(b.tenantId, "hotel-b");
  assert.equal(calls, 2);
});

test("same actor cannot replay a Core-idempotent result into another session", async () => {
  const { executor, ctx, getCalls } = await setup();
  const otherSession = { ...ctx, session: { ...ctx.session, id: crypto.randomUUID() } };

  await executor.execute("test.write", { x: 1 }, ctx, { idempotencyKey: "cross-session-key" });
  await assert.rejects(
    () => executor.execute("test.write", { x: 1 }, otherSession, { idempotencyKey: "cross-session-key" }),
    (e) => e instanceof CoreError && e.code === "IDEMPOTENCY_CONFLICT",
    "approval/ownership are session-bound, so a cached side-effect result must not migrate across sessions",
  );
  assert.equal(getCalls(), 1, "the conflicting second session must not execute a duplicate side effect");
});
