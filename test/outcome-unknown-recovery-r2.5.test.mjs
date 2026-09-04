import assert from "node:assert/strict";
import test from "node:test";
import { CoreError } from "../dist/core/errors.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { InMemoryApprovalStore } from "../dist/webchat/approval.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";
import { emptyConversationState } from "../dist/core/conversation-state.js";

const tenant = {
  id: "hotel-demo",
  slug: "hotel-demo",
  status: "active",
  allowedToolIds: ["hms.createReservation"],
  toolPolicies: { "hms.createReservation": "approval" },
};

async function request(handler, path, body, key) {
  if (handler.seededSession && path === "/api/chat") body = { ...body, sessionId: await handler.seededSession };
  return handler(new Request(`https://agent.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  }));
}

function reservationTool(execute) {
  return {
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
    execute,
  };
}

const canonicalPlan = {
  toolId: "hms.createReservation",
  input: { roomId: "room-101", checkIn: "2027-02-10", checkOut: "2027-02-12" },
};

async function seed(runtime) {
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor: { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.reservation.write"] }, channel: "webchat" });
  const state = emptyConversationState();
  state.stay = { checkIn: "2027-02-10", checkOut: "2027-02-12", guests: 1 };
  state.availabilityRoomIds = ["room-101"];
  state.availabilityRooms = [{ id: "room-101", roomNumber: "101", capacity: 2 }];
  await runtime.conversationState.put(context.session.id, state);
  return context.session.id;
}

function runtimeWithTool(tool, onRoute) {
  return new AgentCoreRuntime({
    tenants: [tenant],
    tools: [tool],
    model: {
      async route() {
        onRoute();
        return { kind: "tool", plan: structuredClone(canonicalPlan), mutationGrounding: { kind: "reservation", checkIn: "2027-02-10", checkOut: "2027-02-12", roomIds: ["room-101"] } };
      },
    },
  });
}

test("R2.5 OUTCOME_UNKNOWN reissues only the exact approved plan and same idempotency operation can recover without rerouting", async () => {
  let routeCount = 0;
  let executions = 0;
  const executedInputs = [];
  const tool = reservationTool(async (input) => {
    executions += 1;
    executedInputs.push(structuredClone(input));
    if (executions === 1) {
      throw new CoreError("OUTCOME_UNKNOWN", "HMS mutation outcome is unknown", 503);
    }
    return { bookingId: "booking-recovered", status: "CONFIRMED" };
  });
  const runtime = runtimeWithTool(tool, () => { routeCount += 1; });
  const handler = createWebchatHandler(runtime, {
    fixedTenantId: "hotel-demo",
    fixedActorId: "visitor-demo",
    approvalStore: new InMemoryApprovalStore(),
  });
  handler.seededSession = seed(runtime);

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
  assert.equal(uncertainBody.recoveryAttempt, 1);
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

test("R2.5 recovery depth is server-owned, ignores forged client counters, and exhausts after three recovery challenges", async () => {
  let routeCount = 0;
  let executions = 0;
  const executedInputs = [];
  const tool = reservationTool(async (input) => {
    executions += 1;
    executedInputs.push(structuredClone(input));
    throw new CoreError("OUTCOME_UNKNOWN", "HMS mutation outcome is unknown", 503);
  });
  const runtime = runtimeWithTool(tool, () => { routeCount += 1; });
  const handler = createWebchatHandler(runtime, {
    fixedTenantId: "hotel-demo",
    fixedActorId: "visitor-demo",
    approvalStore: new InMemoryApprovalStore(),
  });
  handler.seededSession = seed(runtime);

  const message = "reservala";
  const key = "unknown-recovery-exhaustion";
  const first = await request(handler, "/api/chat", { message }, key);
  const pending = await first.json();
  assert.equal(first.status, 409);
  assert.equal(routeCount, 1);

  let token = pending.approvalToken;
  for (let expectedAttempt = 1; expectedAttempt <= 3; expectedAttempt += 1) {
    const response = await request(handler, "/api/approve", {
      message,
      sessionId: pending.sessionId,
      approvalToken: token,
      recoveryAttempt: 0,
    }, key);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "OUTCOME_UNKNOWN");
    assert.equal(body.recoveryAttempt, expectedAttempt);
    assert.ok(body.recoveryApprovalToken);
    assert.equal(body.recoveryExhausted, undefined);
    token = body.recoveryApprovalToken;
  }

  const exhausted = await request(handler, "/api/approve", {
    message,
    sessionId: pending.sessionId,
    approvalToken: token,
    recoveryAttempt: 0,
  }, key);
  const exhaustedBody = await exhausted.json();
  assert.equal(exhausted.status, 503);
  assert.equal(exhaustedBody.error.code, "OUTCOME_UNKNOWN");
  assert.equal(exhaustedBody.recoveryExhausted, true);
  assert.equal(exhaustedBody.recoveryApprovalToken, undefined);
  assert.match(exhaustedBody.error.message, /manual reconciliation/i);
  assert.equal(routeCount, 1, "all recovery attempts must execute stored plan without rerouting");
  assert.equal(executions, 4, "one original approved execution plus three recovery executions");
  assert.deepEqual(executedInputs, Array.from({ length: 4 }, () => canonicalPlan.input));
});

test("Independent Critic P1: manual-reconciliation OUTCOME_UNKNOWN never issues an automatic recovery approval", async () => {
  let routeCount = 0;
  let executions = 0;
  const tool = reservationTool(async () => {
    executions += 1;
    throw Object.assign(
      new CoreError("OUTCOME_UNKNOWN", "HMS compensation outcome is unknown; manual reconciliation is required", 503),
      { automaticRecoveryAllowed: false },
    );
  });
  const runtime = runtimeWithTool(tool, () => { routeCount += 1; });
  const handler = createWebchatHandler(runtime, {
    fixedTenantId: "hotel-demo",
    fixedActorId: "visitor-demo",
    approvalStore: new InMemoryApprovalStore(),
  });
  handler.seededSession = seed(runtime);

  const message = "reservala";
  const key = "manual-reconciliation-boundary";
  const first = await request(handler, "/api/chat", { message }, key);
  const pending = await first.json();
  assert.equal(first.status, 409);

  const uncertain = await request(handler, "/api/approve", {
    message,
    sessionId: pending.sessionId,
    approvalToken: pending.approvalToken,
  }, key);
  const body = await uncertain.json();

  assert.equal(uncertain.status, 503);
  assert.equal(body.error.code, "OUTCOME_UNKNOWN");
  assert.equal(body.manualReconciliationRequired, true);
  assert.equal(body.recoveryExhausted, true);
  assert.equal(body.recoveryApprovalToken, undefined);
  assert.equal(executions, 1);
  assert.equal(routeCount, 1);
});
