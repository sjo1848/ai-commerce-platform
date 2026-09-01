import assert from "node:assert/strict";
import test from "node:test";
import { CoreError } from "../dist/core/errors.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { InMemoryApprovalStore } from "../dist/webchat/approval.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";

const tenant = {
  id: "hotel-demo",
  slug: "hotel-demo",
  status: "active",
  allowedToolIds: ["hms.createReservation"],
  toolPolicies: { "hms.createReservation": "approval" },
};

function request(handler, path, body, key) {
  return handler(new Request(`https://agent.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  }));
}

test("R2.5 OUTCOME_UNKNOWN reissues only the exact approved plan and same idempotency operation can recover without rerouting", async () => {
  let routeCount = 0;
  let executions = 0;
  const executedInputs = [];
  const tool = {
    id: "hms.createReservation",
    primitive: "RESERVE",
    description: "test reservation",
    risk: "write",
    sideEffect: "reversible",
    idempotencyMode: "core",
    requiredPermissions: ["hms.reservation.write"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { roomId: { type: "string" }, checkIn: { type: "string" }, checkOut: { type: "string" } },
      required: ["roomId", "checkIn", "checkOut"],
    },
    validateInput(input) { return { ok: true, value: structuredClone(input) }; },
    async execute(input) {
      executions += 1;
      executedInputs.push(structuredClone(input));
      if (executions === 1) {
        throw new CoreError("OUTCOME_UNKNOWN", "HMS mutation outcome is unknown", 503);
      }
      return { bookingId: "booking-recovered", status: "CONFIRMED" };
    },
  };
  const canonicalPlan = {
    toolId: "hms.createReservation",
    input: { roomId: "room-101", checkIn: "2027-02-10", checkOut: "2027-02-12" },
  };
  const runtime = new AgentCoreRuntime({
    tenants: [tenant],
    tools: [tool],
    model: {
      async route() {
        routeCount += 1;
        return { kind: "tool", plan: structuredClone(canonicalPlan) };
      },
    },
  });
  const handler = createWebchatHandler(runtime, {
    fixedTenantId: "hotel-demo",
    fixedActorId: "visitor-demo",
    approvalStore: new InMemoryApprovalStore(),
  });

  const message = "reservala";
  const key = "unknown-recovery-key";
  const first = await request(handler, "/api/chat", { message }, key);
  const pending = await first.json();
  assert.equal(first.status, 409);
  assert.equal(pending.error.code, "APPROVAL_REQUIRED");
  assert.equal(routeCount, 1);

  const uncertain = await request(handler, "/api/approve", {
    message,
    sessionId: pending.sessionId,
    approvalToken: pending.approvalToken,
  }, key);
  const uncertainBody = await uncertain.json();
  assert.equal(uncertain.status, 503);
  assert.equal(uncertainBody.error.code, "OUTCOME_UNKNOWN");
  assert.ok(uncertainBody.recoveryApprovalToken);
  assert.equal(executions, 1);
  assert.equal(routeCount, 1, "unknown outcome recovery must not invoke the model again");

  const recovered = await request(handler, "/api/approve", {
    message,
    sessionId: pending.sessionId,
    approvalToken: uncertainBody.recoveryApprovalToken,
  }, key);
  const recoveredBody = await recovered.json();
  assert.equal(recovered.status, 200);
  assert.equal(recoveredBody.data.bookingId, "booking-recovered");
  assert.equal(executions, 2);
  assert.equal(routeCount, 1);
  assert.deepEqual(executedInputs, [canonicalPlan.input, canonicalPlan.input]);
});
