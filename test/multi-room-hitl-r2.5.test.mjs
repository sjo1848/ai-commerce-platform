import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { hmsAgentTools } from "../dist/adapters/hms-agent-tools.js";
import { emptyConversationState } from "../dist/core/conversation-state.js";
import { InMemoryReservationOperationStore } from "../dist/core/reservation-operation-store.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { InMemoryApprovalStore } from "../dist/webchat/approval.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const guestId = "12000000-0000-0000-0000-000000000001";
const roomA = "11000000-0000-0000-0000-000000000101";
const roomB = "11000000-0000-0000-0000-000000000102";
const attackerRoom = "11000000-0000-0000-0000-000000009999";
const bookingA = "13000000-0000-0000-0000-000000000101";
const bookingB = "13000000-0000-0000-0000-000000000102";
const now = () => new Date("2026-08-31T23:00:00.000Z");

function tenant() {
  return {
    id: "hotel-demo",
    slug: "hotel-demo",
    status: "active",
    allowedToolIds: [
      "hms.checkAvailability",
      "hms.getQuote",
      "hms.createReservation",
      "hms.createMultiReservation",
      "hms.cancelReservation",
      "hms.cancelMultiReservation",
    ],
    toolPolicies: {
      "hms.checkAvailability": "auto",
      "hms.getQuote": "auto",
      "hms.createReservation": "approval",
      "hms.createMultiReservation": "approval",
      "hms.cancelReservation": "approval",
      "hms.cancelMultiReservation": "approval",
    },
  };
}

function actor() {
  return {
    id: "visitor-demo",
    type: "customer",
    roles: ["customer"],
    permissions: ["hms.availability.read", "hms.quote.read", "hms.reservation.write", "hms.reservation.cancel"],
  };
}

function mockService() {
  const calls = [];
  let availableRoomIds = [roomA, roomB];
  return {
    calls,
    setAvailableRoomIds(ids) { availableRoomIds = [...ids]; },
    service: {
      async checkAvailability(context, input) {
        calls.push({ method: "checkAvailability", context, input });
        return {
          ok: true,
          data: {
            source: "hms",
            truth: "transactional",
            hotelId: context.hotelId,
            start: input.start,
            end: input.end,
            capacityMode: "not_modeled",
            rooms: availableRoomIds.map((id, index) => ({ id, roomNumber: index === 0 ? "101" : "102", roomType: "DOUBLE", status: "AVAILABLE", priceCents: 10000, currency: "ARS" })),
            traceId: context.traceId,
          },
        };
      },
      async getQuote() { throw new Error("not used"); },
      async createReservation(context, input) {
        calls.push({ method: "createReservation", context, input });
        const bookingId = input.roomId === roomA ? bookingA : bookingB;
        return {
          ok: true,
          data: {
            source: "hms", truth: "transactional", hotelId: context.hotelId,
            bookingId, guestId: input.guestId, roomId: input.roomId,
            start: input.start, end: input.end, status: "CONFIRMED",
            totalCents: 10000, currency: "ARS", replayed: false, traceId: context.traceId,
          },
        };
      },
      async cancelReservation(context, input) {
        calls.push({ method: "cancelReservation", context, input });
        const roomId = input.bookingId === bookingA ? roomA : roomB;
        return {
          ok: true,
          data: {
            source: "hms", truth: "transactional", hotelId: context.hotelId,
            bookingId: input.bookingId, guestId, roomId,
            start: "2027-02-10", end: "2027-02-12", status: "CANCELLED",
            totalCents: 10000, currency: "ARS", replayed: false, traceId: context.traceId,
          },
        };
      },
    },
  };
}

async function setup() {
  let routeCount = 0;
  const model = {
    async route(message) {
      routeCount += 1;
      if (/cancel|anul/i.test(message)) {
        return { kind: "tool", plan: { toolId: "hms.cancelReservation", input: { bookingId: "attacker-booking" } } };
      }
      return {
        kind: "tool",
        plan: {
          toolId: "hms.createReservation",
          input: {
            roomId: attackerRoom,
            guestId: "attacker-guest",
            checkIn: "2099-01-01",
            checkOut: "2099-01-02",
          },
        },
      };
    },
  };
  const mock = mockService();
  const ownership = new InMemoryReservationOperationStore();
  const adapter = new HmsServiceBindingAdapter(mock.service, { "hotel-demo": { hotelId } }, ownership);
  const runtime = new AgentCoreRuntime({
    tenants: [tenant()],
    tools: hmsAgentTools(adapter, { guestIdByTenantActor: { "hotel-demo": { "visitor-demo": guestId } } }),
    now,
    model,
  });
  const approvalStore = new InMemoryApprovalStore(now);
  const handler = createWebchatHandler(runtime, { fixedTenantId: "hotel-demo", fixedActorId: "visitor-demo", approvalStore });
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor: actor(), channel: "webchat", requestId: "seed-r2.5" });
  const state = emptyConversationState();
  state.stay = { checkIn: "2027-02-10", checkOut: "2027-02-12", guests: 2 };
  state.availabilityRoomIds = [roomA, roomB];
  state.availabilityRooms = [
    { id: roomA, roomNumber: "101", roomType: "DOUBLE" },
    { id: roomB, roomNumber: "102", roomType: "DOUBLE" },
  ];
  state.selectedRoomIds = [roomA, roomB];
  state.requestedRoomCount = 2;
  state.roomSelectionRevision = 1;
  await runtime.conversationState.put(context.session.id, state);
  return { runtime, handler, mock, ownership, sessionId: context.session.id, routeCount: () => routeCount };
}

function request(handler, path, body, key) {
  return handler(new Request(`https://agent.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: JSON.stringify(body),
  }));
}

test("R2.5 grounds multi-room create from durable state, requires one exact approval, and executes without model reroute", async () => {
  const env = await setup();
  const message = "reservalas";
  const first = await request(env.handler, "/api/chat", { message, sessionId: env.sessionId }, "multi-create-1");
  const pending = await first.json();
  assert.equal(first.status, 409);
  assert.equal(pending.error.code, "APPROVAL_REQUIRED");
  assert.match(pending.approvalSummary, /2 habitaciones/);
  assert.match(pending.approvalSummary, new RegExp(roomA));
  assert.match(pending.approvalSummary, new RegExp(roomB));
  assert.match(pending.approvalSummary, /2027-02-10/);
  assert.equal(env.mock.calls.filter((call) => call.method === "createReservation").length, 0);
  assert.equal(env.routeCount(), 1);

  const approved = await request(env.handler, "/api/approve", {
    message,
    sessionId: env.sessionId,
    approvalToken: pending.approvalToken,
  }, "multi-create-1");
  const body = await approved.json();
  assert.equal(approved.status, 200);
  assert.equal(body.data.outcome, "confirmed");
  assert.deepEqual(body.data.bookingIds, [bookingA, bookingB]);
  assert.equal(env.routeCount(), 1, "approval must execute stored canonical plan without rerouting the model");

  const creates = env.mock.calls.filter((call) => call.method === "createReservation");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates.map((call) => call.input.roomId), [roomA, roomB]);
  assert.deepEqual(creates.map((call) => call.input.guestId), [guestId, guestId]);
  assert.deepEqual(creates.map((call) => [call.input.start, call.input.end]), [["2027-02-10", "2027-02-12"], ["2027-02-10", "2027-02-12"]]);
});

test("R2.5 stale HMS availability rejects the approved group before any reservation side effect", async () => {
  const env = await setup();
  const message = "reservalas";
  const first = await request(env.handler, "/api/chat", { message, sessionId: env.sessionId }, "multi-stale-1");
  const pending = await first.json();
  assert.equal(first.status, 409);

  env.mock.setAvailableRoomIds([roomA]);
  const approved = await request(env.handler, "/api/approve", {
    message,
    sessionId: env.sessionId,
    approvalToken: pending.approvalToken,
  }, "multi-stale-1");
  const body = await approved.json();
  assert.equal(approved.status, 409);
  assert.equal(body.error.code, "CONFLICT");
  assert.equal(env.mock.calls.filter((call) => call.method === "createReservation").length, 0);
});

test("R2.5 group cancellation is server-grounded, exact-approved, and never uses a forged model booking id", async () => {
  const env = await setup();
  const reserveMessage = "reservalas";
  const reserve = await request(env.handler, "/api/chat", { message: reserveMessage, sessionId: env.sessionId }, "multi-create-cancel-seed");
  const reservePending = await reserve.json();
  assert.equal((await request(env.handler, "/api/approve", {
    message: reserveMessage,
    sessionId: env.sessionId,
    approvalToken: reservePending.approvalToken,
  }, "multi-create-cancel-seed")).status, 200);

  const beforeCancelCalls = env.mock.calls.filter((call) => call.method === "cancelReservation").length;
  const cancelMessage = "cancelá todas las reservas";
  const cancel = await request(env.handler, "/api/chat", { message: cancelMessage, sessionId: env.sessionId }, "multi-cancel-1");
  const cancelPending = await cancel.json();
  assert.equal(cancel.status, 409);
  assert.match(cancelPending.approvalSummary, /2 reservas/);
  assert.match(cancelPending.approvalSummary, new RegExp(bookingA));
  assert.match(cancelPending.approvalSummary, new RegExp(bookingB));
  assert.equal(env.mock.calls.filter((call) => call.method === "cancelReservation").length, beforeCancelCalls);

  const approved = await request(env.handler, "/api/approve", {
    message: cancelMessage,
    sessionId: env.sessionId,
    approvalToken: cancelPending.approvalToken,
  }, "multi-cancel-1");
  const body = await approved.json();
  assert.equal(approved.status, 200);
  assert.equal(body.data.outcome, "cancelled");
  const cancellations = env.mock.calls.filter((call) => call.method === "cancelReservation").slice(beforeCancelCalls);
  assert.deepEqual(cancellations.map((call) => call.input.bookingId), [bookingA, bookingB]);
  assert.ok(cancellations.every((call) => call.input.bookingId !== "attacker-booking"));
});
