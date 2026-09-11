import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { hmsAgentTools } from "../dist/adapters/hms-agent-tools.js";
import { RESERVATION_GROUP_STATE_TOOL_ID } from "../dist/core/reservation-group-state.js";
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
const now = () => new Date("2026-09-01T02:00:00.000Z");

function tenant() {
  return {
    id: "hotel-demo",
    slug: "hotel-demo",
    status: "active",
    allowedToolIds: ["hms.cancelReservation", "hms.cancelMultiReservation"],
    toolPolicies: {
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
    permissions: ["hms.reservation.cancel"],
  };
}

async function setup() {
  const calls = [];
  const service = {
    async checkAvailability() { throw new Error("not used"); },
    async getQuote() { throw new Error("not used"); },
    async createReservation() { throw new Error("not used"); },
    async cancelReservation(context, input) {
      calls.push({ context, input });
      return {
        ok: true,
        data: {
          source: "hms",
          truth: "transactional",
          hotelId: context.hotelId,
          bookingId: input.bookingId,
          guestId,
          roomId: input.bookingId === bookingA ? roomA : roomB,
          start: "2027-02-10",
          end: "2027-02-12",
          status: "CANCELLED",
          totalCents: 10000,
          currency: "ARS",
          replayed: false,
          traceId: context.traceId,
        },
      };
    },
  };

  const ownership = new InMemoryReservationOperationStore();
  const adapter = new HmsServiceBindingAdapter(service, { "hotel-demo": { hotelId } }, ownership);
  const runtime = new AgentCoreRuntime({
    tenants: [tenant()],
    tools: hmsAgentTools(adapter, { guestIdByTenantActor: { "hotel-demo": { "visitor-demo": guestId } } }),
    now,
    model: {
      async route(message) {
        if (/menos/.test(message)) return { kind: "message", purpose: "clarification", message: "¿Qué reserva específica del grupo querés cancelar?", missing: ["booking"], statePatch: {}, mutationGrounding: null };
        return { kind: "tool", plan: { toolId: "hms.cancelReservation", input: { bookingId: bookingA } }, mutationGrounding: { kind: "cancellation", scope: "single", bookingId: bookingA } };
      },
    },
  });
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor: actor(), channel: "webchat", requestId: "critic-scope-seed" });
  await ownership.bind({ sessionId: context.session.id, tenantId: "hotel-demo", actorId: "visitor-demo", bookingId: bookingA, operationToken: "token-a" });
  await ownership.bind({ sessionId: context.session.id, tenantId: "hotel-demo", actorId: "visitor-demo", bookingId: bookingB, operationToken: "token-b" });
  await runtime.conversation.append(context.session.id, {
    role: "tool",
    toolId: RESERVATION_GROUP_STATE_TOOL_ID,
    content: JSON.stringify({
      activeBookingIds: [bookingA, bookingB],
      activeBookings: [
        { bookingId: bookingA, roomId: roomA, roomNumber: "101" },
        { bookingId: bookingB, roomId: roomB, roomNumber: "102" },
      ],
      revision: 1,
      status: "confirmed",
    }),
  });

  const handler = createWebchatHandler(runtime, {
    fixedTenantId: "hotel-demo",
    fixedActorId: "visitor-demo",
    approvalStore: new InMemoryApprovalStore(now),
  });
  return { handler, sessionId: context.session.id, calls };
}

function request(handler, body, key) {
  return handler(new Request("https://agent.example/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  }));
}

test("Independent Critic P1: negated all-group language cannot override an explicit specific cancellation", async () => {
  const env = await setup();
  const response = await request(env.handler, {
    message: "No canceles todas, cancelá la primera reserva",
    sessionId: env.sessionId,
  }, "critic-negated-all");
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "APPROVAL_REQUIRED");
  assert.match(body.approvalSummary, new RegExp(bookingA));
  assert.doesNotMatch(body.approvalSummary, new RegExp(bookingB), "negated all-group wording must not expand scope to the second booking");
  assert.equal(env.calls.length, 0);
});

test("Independent Critic P1: unsupported all-except-one scope clarifies instead of cancelling the whole group", async () => {
  const env = await setup();
  const response = await request(env.handler, {
    message: "Cancelá todas menos la primera",
    sessionId: env.sessionId,
  }, "critic-all-except-one");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.outcome, "clarification");
  assert.deepEqual(body.missing, ["booking"]);
  assert.match(body.message, /específica|grupo|todas/i);
  assert.equal(body.approvalToken, undefined);
  assert.equal(env.calls.length, 0);
});
