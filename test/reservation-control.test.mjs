import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { operationFingerprint } from "../dist/core/operation-fingerprint.js";
import { InMemoryReservationOperationStore } from "../dist/core/reservation-operation-store.js";
import { InMemoryApprovalStore } from "../dist/webchat/approval.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const roomId = "11000000-0000-0000-0000-000000000001";
const otherRoomId = "11000000-0000-0000-0000-000000000002";
const guestId = "12000000-0000-0000-0000-000000000001";
const bookingId = "13000000-0000-0000-0000-000000000099";
const now = () => new Date("2026-08-30T01:30:00.000Z");
const reserveMessage = `reservar habitacion ${roomId} huesped ${guestId} del 2027-02-10 al 2027-02-12`;
const invalidReserveMessage = `reservar habitacion ${roomId} huesped ${guestId}`;

function tenant() {
  return {
    id: "hotel-demo", slug: "hotel-demo", status: "active",
    allowedToolIds: ["hms.checkAvailability", "hms.getQuote", "hms.createReservation", "hms.cancelReservation"],
    toolPolicies: {
      "hms.checkAvailability": "auto", "hms.getQuote": "auto",
      "hms.createReservation": "approval", "hms.cancelReservation": "approval",
    },
  };
}

function mockService() {
  const calls = [];
  const createdTokens = new Set();
  let cancelled = false;
  return {
    calls,
    service: {
      async checkAvailability(context, input) {
        calls.push({ method: "checkAvailability", context, input });
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: context.hotelId, start: input.start, end: input.end, capacityMode: "not_modeled", rooms: [], traceId: context.traceId } };
      },
      async getQuote(context, input) {
        calls.push({ method: "getQuote", context, input });
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: context.hotelId, roomId: input.roomId, start: input.start, end: input.end, nights: 2, nightlyRateCents: 10000, totalCents: 20000, currency: "ARS", traceId: context.traceId } };
      },
      async createReservation(context, input) {
        calls.push({ method: "createReservation", context, input });
        const replayed = createdTokens.has(input.operationToken);
        createdTokens.add(input.operationToken);
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: context.hotelId, bookingId, guestId: input.guestId, roomId: input.roomId, start: input.start, end: input.end, status: "CONFIRMED", totalCents: 20000, currency: "ARS", replayed, traceId: context.traceId } };
      },
      async cancelReservation(context, input) {
        calls.push({ method: "cancelReservation", context, input });
        const replayed = cancelled;
        cancelled = true;
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: context.hotelId, bookingId: input.bookingId, guestId, roomId, start: "2027-02-10", end: "2027-02-12", status: "CANCELLED", totalCents: 20000, currency: "ARS", replayed, traceId: context.traceId } };
      },
    },
  };
}

const structuredReservationModel = {
  async route(message) {
    if (/cancelar reserva/.test(message)) return { kind: "tool", plan: { toolId: "hms.cancelReservation", input: { bookingId } } };
    return { kind: "tool", plan: { toolId: "hms.createReservation", input: { roomId, guestId, checkIn: "2027-02-10", checkOut: "2027-02-12" } } };
  },
};

function setup({ approvalStore = new InMemoryApprovalStore(now), model } = {}) {
  const mock = mockService();
  const reservationOperations = new InMemoryReservationOperationStore();
  const adapter = new HmsServiceBindingAdapter(mock.service, { "hotel-demo": { hotelId } }, reservationOperations);
  const runtime = new AgentCoreRuntime({
    tenants: [tenant()],
    tools: [adapter.checkAvailabilityTool(), adapter.getQuoteTool(), adapter.createReservationTool(), adapter.cancelReservationTool()],
    now,
    model: model ?? structuredReservationModel,
  });
  const handler = createWebchatHandler(runtime, { fixedTenantId: "hotel-demo", fixedActorId: "visitor-demo", approvalStore });
  return { mock, runtime, handler, approvalStore, reservationOperations };
}

function request(handler, path, body, headers = {}) {
  return handler(new Request(`https://agent.example${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
}

async function pendingApproval(handler, key = "reserve-op-0001", message = reserveMessage) {
  const response = await request(handler, "/api/chat", { message }, { "idempotency-key": key });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "APPROVAL_REQUIRED");
  assert.equal(typeof body.sessionId, "string");
  assert.equal(typeof body.approvalToken, "string");
  return body;
}

async function approvedMeta(toolId, input, idempotencyKey) {
  return { idempotencyKey, humanApproved: true, approvedOperationFingerprint: await operationFingerprint(toolId, input) };
}

function actor(...permissions) {
  return { id: "visitor-demo", type: "customer", roles: ["customer"], permissions };
}

test("reservation requires approval and forged headers cannot bypass policy", async () => {
  const { handler, mock } = setup();
  const response = await request(handler, "/api/chat", { message: reserveMessage }, { "idempotency-key": "reserve-op-1", "x-human-approval": "confirmed", "x-actor-id": "forged" });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "APPROVAL_REQUIRED");
  assert.equal(typeof body.approvalToken, "string");
  assert.equal(mock.calls.length, 0);
});

test("approval requires existing session, server challenge and idempotency key", async () => {
  const { handler, mock } = setup();
  const noSession = await request(handler, "/api/approve", { message: reserveMessage, approvalToken: "fake" }, { "idempotency-key": "op" });
  assert.equal(noSession.status, 400);
  const pending = await pendingApproval(handler, "reserve-op-bootstrap");
  const noToken = await request(handler, "/api/approve", { message: reserveMessage, sessionId: pending.sessionId }, { "idempotency-key": "reserve-op-bootstrap" });
  assert.equal(noToken.status, 403);
  const noKey = await request(handler, "/api/approve", { message: reserveMessage, sessionId: pending.sessionId, approvalToken: pending.approvalToken });
  assert.equal(noKey.status, 400);
  assert.equal(mock.calls.length, 0);
});

test("approval challenge is bound to message/key and single-use", async () => {
  const { handler, mock } = setup();
  const pending = await pendingApproval(handler, "reserve-op-bound");
  const wrongKey = await request(handler, "/api/approve", { message: reserveMessage, sessionId: pending.sessionId, approvalToken: pending.approvalToken }, { "idempotency-key": "different" });
  assert.equal(wrongKey.status, 403);
  const wrongMessage = await request(handler, "/api/approve", { message: `${reserveMessage} distinta`, sessionId: pending.sessionId, approvalToken: pending.approvalToken }, { "idempotency-key": "reserve-op-bound" });
  assert.equal(wrongMessage.status, 403);
  const body = { message: reserveMessage, sessionId: pending.sessionId, approvalToken: pending.approvalToken };
  const headers = { "idempotency-key": "reserve-op-bound" };
  assert.equal((await request(handler, "/api/approve", body, headers)).status, 200);
  assert.equal((await request(handler, "/api/approve", body, headers)).status, 403);
  assert.equal(mock.calls.length, 1);
});

test("approval executes the exact validated plan without rerouting the model", async () => {
  let routeCount = 0;
  const model = { async route() { routeCount += 1; return { kind: "tool", plan: { toolId: "hms.createReservation", input: { guestId, roomId: routeCount === 1 ? roomId : otherRoomId, checkIn: "2027-02-10", checkOut: "2027-02-12" } } }; } };
  const routed = setup({ model });
  const pending = await pendingApproval(routed.handler, "reserve-op-reroute");
  assert.equal(routeCount, 1);
  const approved = await request(routed.handler, "/api/approve", { message: reserveMessage, sessionId: pending.sessionId, approvalToken: pending.approvalToken }, { "idempotency-key": "reserve-op-reroute" });
  assert.equal(approved.status, 200);
  assert.equal(routeCount, 1, "approval must not invoke the model a second time");
  assert.equal(routed.mock.calls.length, 1);
  assert.equal(routed.mock.calls[0].method, "createReservation");
  assert.equal(routed.mock.calls[0].input.roomId, roomId);

  const invalidModel = { async route() { return { kind: "tool", plan: { toolId: "hms.createReservation", input: { guestId, roomId } } }; } };
  const invalid = setup({ model: invalidModel });
  const bad = await request(invalid.handler, "/api/chat", { message: invalidReserveMessage }, { "idempotency-key": "invalid-plan" });
  const badBody = await bad.json();
  assert.equal(bad.status, 400);
  assert.equal(badBody.approvalToken, undefined);
  assert.equal(invalid.mock.calls.length, 0);
});

test("approved reservation forwards trusted metadata, pins actor, and stores ownership", async () => {
  const { handler, mock, reservationOperations } = setup();
  const message = `${reserveMessage} operationToken attacker-controlled`;
  const first = await request(handler, "/api/chat", { message }, { "idempotency-key": "reserve-create-1", "x-actor-id": "forged" });
  const pending = await first.json();
  const response = await request(handler, "/api/approve", { message, sessionId: pending.sessionId, approvalToken: pending.approvalToken }, { "idempotency-key": "reserve-create-1", "x-actor-id": "forged-again" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.status, "CONFIRMED");
  assert.equal(mock.calls[0].context.actorId, "visitor-demo");
  assert.equal(mock.calls[0].input.operationToken, "reserve-create-1");
  assert.equal(await reservationOperations.get({ sessionId: pending.sessionId, tenantId: "hotel-demo", actorId: "visitor-demo", bookingId }), "reserve-create-1");
});

test("downstream replay remains visible to HMS and is audited as replayed", async () => {
  const { runtime, mock } = setup();
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor: actor("hms.reservation.write"), channel: "webchat", requestId: "reserve-trace" });
  const input = { guestId, roomId, checkIn: "2027-02-10", checkOut: "2027-02-12" };
  const meta = await approvedMeta("hms.createReservation", input, "reserve-replay-1");
  const first = await runtime.executor.execute("hms.createReservation", input, context, meta);
  const second = await runtime.executor.execute("hms.createReservation", input, context, meta);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(mock.calls.filter((call) => call.method === "createReservation").length, 2);
  const terminal = runtime.audit.events.filter((event) => event.toolId === "hms.createReservation" && ["succeeded", "replayed"].includes(event.status));
  assert.deepEqual(terminal.map((event) => event.status), ["succeeded", "replayed"]);
  assert.equal(terminal[1].detail, "downstream_authoritative_replay");
});

test("cancellation uses original trusted create token, not its new cancellation idempotency key", async () => {
  const { runtime, mock } = setup();
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor: actor("hms.reservation.write", "hms.reservation.cancel"), channel: "webchat", requestId: "reservation-lifecycle" });
  const createInput = { guestId, roomId, checkIn: "2027-02-10", checkOut: "2027-02-12" };
  const created = await runtime.executor.execute("hms.createReservation", createInput, context, await approvedMeta("hms.createReservation", createInput, "original-create-token"));
  assert.equal(created.bookingId, bookingId);

  const cancelInput = { bookingId };
  await assert.rejects(runtime.executor.execute("hms.cancelReservation", cancelInput, context, { idempotencyKey: "new-cancel-key" }), (error) => error?.code === "APPROVAL_REQUIRED");
  const cancelled = await runtime.executor.execute("hms.cancelReservation", cancelInput, context, await approvedMeta("hms.cancelReservation", cancelInput, "new-cancel-key"));
  assert.equal(cancelled.status, "CANCELLED");
  const cancelCall = mock.calls.findLast((call) => call.method === "cancelReservation");
  assert.equal(cancelCall.input.operationToken, "original-create-token");
  assert.notEqual(cancelCall.input.operationToken, "new-cancel-key");
});

test("cancellation fails closed without trusted ownership binding", async () => {
  const { runtime, mock } = setup();
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor: actor("hms.reservation.cancel"), channel: "webchat", requestId: "cancel-unowned" });
  const input = { bookingId };
  await assert.rejects(runtime.executor.execute("hms.cancelReservation", input, context, await approvedMeta("hms.cancelReservation", input, "cancel-key")), (error) => error?.code === "FORBIDDEN");
  assert.equal(mock.calls.filter((call) => call.method === "cancelReservation").length, 0);
});

test("deterministic fallback never prepares natural-language reserve/cancel writes", async () => {
  const { DeterministicModelRouter } = await import("../dist/core/deterministic-model.js");
  const model = new DeterministicModelRouter();
  const tools = [
    { id: "hms.createReservation", primitive: "RESERVE", description: "reserve", risk: "write" },
    { id: "hms.cancelReservation", primitive: "CANCEL", description: "cancel", risk: "write" },
  ];
  const reserve = await model.route(reserveMessage, {}, tools);
  assert.equal(reserve.kind, "message");
  assert.equal(Object.hasOwn(reserve, "plan"), false);
  assert.equal(Object.hasOwn(reserve, "statePatch"), false);
  const cancel = await model.route(`cancelar reserva ${bookingId}`, {}, tools);
  assert.equal(cancel.kind, "message");
  assert.equal(Object.hasOwn(cancel, "plan"), false);
  assert.equal(Object.hasOwn(cancel, "statePatch"), false);
});
