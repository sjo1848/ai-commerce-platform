import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { hmsAgentTools } from "../dist/adapters/hms-agent-tools.js";
import { emptyConversationState, updateConversationStateFromTool } from "../dist/core/conversation-state.js";
import { InMemoryReservationOperationStore } from "../dist/core/reservation-operation-store.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { InMemoryApprovalStore } from "../dist/webchat/approval.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const guestId = "12000000-0000-0000-0000-000000000001";
const roomA = "11000000-0000-0000-0000-000000000101";
const roomB = "11000000-0000-0000-0000-000000000102";
const bookingA = "13000000-0000-0000-0000-000000000101";
const bookingB = "13000000-0000-0000-0000-000000000102";
const now = () => new Date("2026-09-01T01:00:00.000Z");

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

function service() {
  const calls = [];
  return {
    calls,
    implementation: {
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
            rooms: [
              { id: roomA, roomNumber: "101", roomType: "DOUBLE", status: "AVAILABLE", priceCents: 10000, currency: "ARS" },
              { id: roomB, roomNumber: "102", roomType: "DOUBLE", status: "AVAILABLE", priceCents: 10000, currency: "ARS" },
            ],
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
  const model = {
    async route(message, _context, _tools, _conversation, state) {
      if (/cancel|anul/i.test(message)) {
        const active = state?.activeBookings ?? [];
        const requested = /101|primera/.test(message) ? bookingA : null;
        if (requested && active.some((b) => b.bookingId === requested)) return { kind: "tool", plan: { toolId: "hms.cancelReservation", input: { bookingId: requested } }, mutationGrounding: { kind: "cancellation", scope: "single", bookingId: requested } };
        return { kind: "message", purpose: "clarification", message: "¿Qué reserva querés cancelar?", missing: ["booking"], statePatch: {}, mutationGrounding: null };
      }
      return {
        kind: "tool",
        plan: { toolId: "hms.createMultiReservation", input: { roomId: "model-room", checkIn: "2099-01-01", checkOut: "2099-01-02" } },
        mutationGrounding: { kind: "reservation", checkIn: "2027-02-10", checkOut: "2027-02-12", roomIds: [roomA, roomB] },
      };
    },
  };

  const hms = service();
  const ownership = new InMemoryReservationOperationStore();
  const adapter = new HmsServiceBindingAdapter(hms.implementation, { "hotel-demo": { hotelId } }, ownership);
  const runtime = new AgentCoreRuntime({
    tenants: [tenant()],
    tools: hmsAgentTools(adapter, { guestIdByTenantActor: { "hotel-demo": { "visitor-demo": guestId } } }),
    now,
    model,
  });
  const approvalStore = new InMemoryApprovalStore(now);
  const handler = createWebchatHandler(runtime, { fixedTenantId: "hotel-demo", fixedActorId: "visitor-demo", approvalStore });
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor: actor(), channel: "webchat", requestId: "seed-r2.5-room-cancel" });

  const state = updateConversationStateFromTool(
    emptyConversationState(),
    "hms.checkAvailability",
    { checkIn: "2027-02-10", checkOut: "2027-02-12", guests: 2 },
    { rooms: [
      { id: roomA, roomNumber: "101", roomType: "DOUBLE" },
      { id: roomB, roomNumber: "102", roomType: "DOUBLE" },
    ] },
  );
  state.selectedRoomIds = [roomA, roomB];
  state.requestedRoomCount = 2;
  state.roomSelectionRevision = 1;
  await runtime.conversationState.put(context.session.id, state);

  return { runtime, handler, hms, sessionId: context.session.id };
}

function request(handler, path, body, key) {
  return handler(new Request(`https://agent.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  }));
}

async function createGroup(env) {
  const message = "reservalas";
  const pendingResponse = await request(env.handler, "/api/chat", { message, sessionId: env.sessionId }, "seed-group");
  const pending = await pendingResponse.json();
  assert.equal(pendingResponse.status, 409);
  const approved = await request(env.handler, "/api/approve", {
    message,
    sessionId: env.sessionId,
    approvalToken: pending.approvalToken,
  }, "seed-group");
  assert.equal(approved.status, 200);
}

async function approveCancellation(env, message, key) {
  const pendingResponse = await request(env.handler, "/api/chat", { message, sessionId: env.sessionId }, key);
  const pending = await pendingResponse.json();
  assert.equal(pendingResponse.status, 409);
  assert.equal(pending.error.code, "APPROVAL_REQUIRED");
  const approved = await request(env.handler, "/api/approve", {
    message,
    sessionId: env.sessionId,
    approvalToken: pending.approvalToken,
  }, key);
  return { pending, approved, body: await approved.json() };
}

test("QA P2: specific room cancellation is grounded server-side without trusting model booking mapping", async () => {
  const env = await setup();
  await createGroup(env);

  const message = "cancelá la habitación 101";
  const response = await request(env.handler, "/api/chat", { message, sessionId: env.sessionId }, "cancel-room-101");
  const body = await response.json();

  assert.equal(response.status, 409, "a human room reference should resolve to an exact approval, not fall back to ambiguity");
  assert.equal(body.error.code, "APPROVAL_REQUIRED");
  assert.match(body.approvalSummary, new RegExp(bookingA));
  assert.doesNotMatch(body.approvalSummary, new RegExp(bookingB));
  assert.equal(env.hms.calls.filter((call) => call.method === "cancelReservation").length, 0, "approval must still precede the side effect");
});

test("QA reclosure: ordinal cancellation resolves server-side without model booking authority", async () => {
  const env = await setup();
  await createGroup(env);

  const response = await request(env.handler, "/api/chat", {
    message: "cancelá la primera",
    sessionId: env.sessionId,
  }, "cancel-first-room");
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "APPROVAL_REQUIRED");
  assert.match(body.approvalSummary, new RegExp(bookingA));
  assert.doesNotMatch(body.approvalSummary, new RegExp(bookingB));
  assert.equal(env.hms.calls.filter((call) => call.method === "cancelReservation").length, 0);
});

test("QA reclosure: unknown room reference clarifies and never trusts forged model booking", async () => {
  const env = await setup();
  await createGroup(env);

  const cancelsBefore = env.hms.calls.filter((call) => call.method === "cancelReservation").length;
  const response = await request(env.handler, "/api/chat", {
    message: "cancelá la habitación 999",
    sessionId: env.sessionId,
  }, "cancel-unknown-room");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.outcome, "clarification");
  assert.deepEqual(body.missing, ["booking"]);
  assert.equal(body.approvalToken, undefined);
  assert.match(body.message, /no encuentro|indicame|reserva/i);
  assert.equal(env.hms.calls.filter((call) => call.method === "cancelReservation").length, cancelsBefore);
});

test("QA P1: stale cancelled room reference cannot silently target the only remaining booking", async () => {
  const env = await setup();
  await createGroup(env);

  const first = await approveCancellation(env, "cancelá la habitación 101", "cancel-101-once");
  assert.equal(first.approved.status, 200);
  assert.equal(first.body.data.bookingId, bookingA);

  const cancelsBefore = env.hms.calls.filter((call) => call.method === "cancelReservation").length;
  const response = await request(env.handler, "/api/chat", {
    message: "cancelá la habitación 101",
    sessionId: env.sessionId,
  }, "cancel-101-again");
  const body = await response.json();

  assert.equal(response.status, 200, "stale explicit room reference must clarify even when exactly one other booking remains");
  assert.equal(body.outcome, "clarification");
  assert.deepEqual(body.missing, ["booking"]);
  assert.equal(body.approvalToken, undefined);
  assert.match(body.message, /no encuentro|indicame|reserva/i);
  assert.equal(env.hms.calls.filter((call) => call.method === "cancelReservation").length, cancelsBefore, "remaining room 102 must not become the implicit target");
});
