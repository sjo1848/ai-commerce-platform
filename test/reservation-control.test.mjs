import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const roomId = "11000000-0000-0000-0000-000000000001";
const guestId = "12000000-0000-0000-0000-000000000001";
const bookingId = "13000000-0000-0000-0000-000000000099";

function tenant() {
  return {
    id: "hotel-demo",
    slug: "hotel-demo",
    status: "active",
    allowedToolIds: ["hms.checkAvailability", "hms.getQuote", "hms.createReservation", "hms.cancelReservation"],
    toolPolicies: {
      "hms.checkAvailability": "auto",
      "hms.getQuote": "auto",
      "hms.createReservation": "approval",
      "hms.cancelReservation": "approval",
    },
  };
}

function mockService() {
  const calls = [];
  const tokens = new Set();
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
        const replayed = tokens.has(input.operationToken);
        tokens.add(input.operationToken);
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: context.hotelId, bookingId, guestId: input.guestId, roomId: input.roomId, start: input.start, end: input.end, status: "CONFIRMED", totalCents: 20000, currency: "ARS", replayed, traceId: context.traceId } };
      },
      async cancelReservation(context, input) {
        calls.push({ method: "cancelReservation", context, input });
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: context.hotelId, bookingId: input.bookingId, guestId, roomId, start: "2027-02-10", end: "2027-02-12", status: "CANCELLED", totalCents: 20000, currency: "ARS", replayed: false, traceId: context.traceId } };
      },
    },
  };
}

function setup() {
  const mock = mockService();
  const adapter = new HmsServiceBindingAdapter(mock.service, { "hotel-demo": { hotelId } });
  const runtime = new AgentCoreRuntime({
    tenants: [tenant()],
    tools: [adapter.checkAvailabilityTool(), adapter.getQuoteTool(), adapter.createReservationTool(), adapter.cancelReservationTool()],
    now: () => new Date("2026-08-30T01:30:00.000Z"),
  });
  const handler = createWebchatHandler(runtime, { fixedTenantId: "hotel-demo", fixedActorId: "visitor-demo" });
  return { mock, runtime, handler };
}

const reserveMessage = `reservar habitacion ${roomId} huesped ${guestId} del 2027-02-10 al 2027-02-12`;

function request(handler, path, body, headers = {}) {
  return handler(new Request(`https://agent.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

test("reservation requires explicit approval before any RPC side effect", async () => {
  const { handler, mock } = setup();
  const response = await request(handler, "/api/chat", { message: reserveMessage }, {
    "idempotency-key": "reserve-op-0001",
    "x-actor-id": "forged-actor",
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "APPROVAL_REQUIRED");
  assert.equal(typeof body.sessionId, "string");
  assert.equal(mock.calls.length, 0);
});

test("forged approval header on the ordinary chat route cannot bypass policy", async () => {
  const { handler, mock } = setup();
  const response = await request(handler, "/api/chat", { message: reserveMessage }, {
    "idempotency-key": "reserve-op-forged",
    "x-human-approval": "confirmed",
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "APPROVAL_REQUIRED");
  assert.equal(mock.calls.length, 0);
});

test("approval route requires an existing server session", async () => {
  const { handler, mock } = setup();
  const response = await request(handler, "/api/approve", { message: reserveMessage }, {
    "idempotency-key": "reserve-op-no-session",
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "BAD_REQUEST");
  assert.match(body.error.message, /existing session/i);
  assert.equal(mock.calls.length, 0);
});

test("approved side effect still requires an idempotency key", async () => {
  const { handler, mock } = setup();
  const first = await request(handler, "/api/chat", { message: reserveMessage }, { "idempotency-key": "reserve-op-bootstrap" });
  const pending = await first.json();
  assert.equal(first.status, 409);

  const response = await request(handler, "/api/approve", { message: reserveMessage, sessionId: pending.sessionId });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "IDEMPOTENCY_REQUIRED");
  assert.equal(mock.calls.length, 0);
});

test("approved reservation forwards only trusted operation metadata and pins actor identity", async () => {
  const { handler, mock } = setup();
  const first = await request(handler, "/api/chat", { message: `${reserveMessage} operationToken attacker-controlled` }, {
    "idempotency-key": "reserve-op-0001",
    "x-actor-id": "forged-actor",
  });
  const pending = await first.json();
  assert.equal(first.status, 409);

  const response = await request(handler, "/api/approve", {
    message: `${reserveMessage} operationToken attacker-controlled`,
    sessionId: pending.sessionId,
  }, {
    "idempotency-key": "reserve-op-0001",
    "x-actor-id": "another-forged-actor",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.status, "CONFIRMED");
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].method, "createReservation");
  assert.equal(mock.calls[0].context.actorId, "visitor-demo");
  assert.equal(mock.calls[0].context.hotelId, hotelId);
  assert.equal(mock.calls[0].input.operationToken, "reserve-op-0001");
  assert.equal(mock.calls[0].input.roomId, roomId);
  assert.equal(mock.calls[0].input.guestId, guestId);
});

test("downstream idempotency does not let Core memory hide a replay from HMS", async () => {
  const { runtime, mock } = setup();
  const actor = { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.reservation.write"] };
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor, channel: "webchat", requestId: "reserve-trace" });
  const input = { guestId, roomId, checkIn: "2027-02-10", checkOut: "2027-02-12" };

  const first = await runtime.executor.execute("hms.createReservation", input, context, { idempotencyKey: "reserve-op-0002", humanApproved: true });
  const second = await runtime.executor.execute("hms.createReservation", input, context, { idempotencyKey: "reserve-op-0002", humanApproved: true });

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(mock.calls.filter((call) => call.method === "createReservation").length, 2);
});

test("cancel tool requires internal approval metadata and forwards the same token to HMS", async () => {
  const { runtime, mock } = setup();
  const actor = { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.reservation.cancel"] };
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor, channel: "webchat", requestId: "cancel-trace" });

  await assert.rejects(
    runtime.executor.execute("hms.cancelReservation", { bookingId }, context, { idempotencyKey: "reserve-op-0003" }),
    (error) => error?.code === "APPROVAL_REQUIRED",
  );
  assert.equal(mock.calls.length, 0);

  const result = await runtime.executor.execute("hms.cancelReservation", { bookingId }, context, {
    idempotencyKey: "reserve-op-0003",
    humanApproved: true,
  });
  assert.equal(result.status, "CANCELLED");
  assert.equal(mock.calls[0].input.operationToken, "reserve-op-0003");
  assert.equal(mock.calls[0].input.bookingId, bookingId);
});

test("deterministic model routes explicit reserve/cancel intent but never execution metadata", async () => {
  const model = new DeterministicModelRouter();
  const tools = [
    { id: "hms.createReservation", primitive: "RESERVE", description: "reserve", risk: "write" },
    { id: "hms.cancelReservation", primitive: "CANCEL", description: "cancel", risk: "write" },
  ];
  const reserve = await model.route(reserveMessage, {}, tools);
  assert.equal(reserve.kind, "tool");
  assert.equal(reserve.plan.toolId, "hms.createReservation");
  assert.deepEqual(Object.keys(reserve.plan).sort(), ["input", "toolId"]);
  assert.deepEqual(reserve.plan.input, { roomId, guestId, checkIn: "2027-02-10", checkOut: "2027-02-12" });

  const cancel = await model.route(`cancelar reserva ${bookingId}`, {}, tools);
  assert.equal(cancel.kind, "tool");
  assert.equal(cancel.plan.toolId, "hms.cancelReservation");
  assert.deepEqual(cancel.plan.input, { bookingId });
});
