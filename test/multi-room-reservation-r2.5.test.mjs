import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { InMemoryReservationOperationStore } from "../dist/core/reservation-operation-store.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const guestId = "12000000-0000-0000-0000-000000000001";
const roomA = "11000000-0000-0000-0000-000000000101";
const roomB = "11000000-0000-0000-0000-000000000102";
const bookingA = "13000000-0000-0000-0000-000000000101";
const bookingB = "13000000-0000-0000-0000-000000000102";

function context() {
  return {
    requestId: "r2.5-create",
    now: "2026-08-31T22:00:00.000Z",
    tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: ["hms.createMultiReservation"] },
    actor: { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.reservation.write"] },
    session: { id: "session-r2.5", tenantId: "hotel-demo", actorId: "visitor-demo", channel: "webchat", createdAt: "2026-08-31T22:00:00.000Z", expiresAt: "2026-09-01T22:00:00.000Z" },
  };
}

function mockService() {
  const calls = [];
  return {
    calls,
    service: {
      async checkAvailability() { throw new Error("not used"); },
      async getQuote() { throw new Error("not used"); },
      async createReservation(ctx, input) {
        calls.push({ method: "createReservation", ctx, input });
        const bookingId = input.roomId === roomA ? bookingA : bookingB;
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: ctx.hotelId, bookingId, guestId: input.guestId, roomId: input.roomId, start: input.start, end: input.end, status: "CONFIRMED", totalCents: 10000, currency: "ARS", replayed: false, traceId: ctx.traceId } };
      },
      async cancelReservation() { throw new Error("not used"); },
    },
  };
}

function setup() {
  const mock = mockService();
  const ownership = new InMemoryReservationOperationStore();
  const adapter = new HmsServiceBindingAdapter(mock.service, { "hotel-demo": { hotelId } }, ownership);
  return { mock, ownership, adapter };
}

const validInput = {
  guestId,
  roomIds: [roomA, roomB],
  checkIn: "2027-02-10",
  checkOut: "2027-02-12",
};

test("R2.5 exposes a composite create tool governed by Core idempotency", () => {
  const { adapter } = setup();
  const tool = adapter.createMultiReservationTool();
  assert.equal(tool.id, "hms.createMultiReservation");
  assert.equal(tool.primitive, "RESERVE");
  assert.equal(tool.risk, "write");
  assert.equal(tool.sideEffect, "reversible");
  assert.equal(tool.idempotencyMode, "core");
  assert.deepEqual(tool.requiredPermissions, ["hms.reservation.write"]);
});

test("R2.5 multi-room create validates 2-10 unique rooms and never canonicalizes trusted execution metadata", () => {
  const { adapter } = setup();
  const tool = adapter.createMultiReservationTool();

  assert.equal(tool.validateInput({ ...validInput, roomIds: [roomA] }).ok, false);
  assert.equal(tool.validateInput({ ...validInput, roomIds: [roomA, roomA] }).ok, false);
  assert.equal(tool.validateInput({ ...validInput, roomIds: Array.from({ length: 11 }, (_, index) => `room-${index}`) }).ok, false);

  const validated = tool.validateInput({
    ...validInput,
    operationToken: "attacker-token",
    approvalToken: "attacker-approval",
    tenantId: "attacker-tenant",
  });
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.value, validInput);
});

test("R2.5 composite create derives distinct child tokens server-side and binds every confirmed booking", async () => {
  const { adapter, mock, ownership } = setup();
  const tool = adapter.createMultiReservationTool();
  const validated = tool.validateInput(validInput);
  assert.equal(validated.ok, true);

  const result = await tool.execute(validated.value, context(), { idempotencyKey: "group-create-001", humanApproved: true });

  assert.equal(result.outcome, "confirmed");
  assert.deepEqual(result.bookingIds, [bookingA, bookingB]);
  const creates = mock.calls.filter((call) => call.method === "createReservation");
  assert.equal(creates.length, 2);
  assert.notEqual(creates[0].input.operationToken, "group-create-001");
  assert.notEqual(creates[1].input.operationToken, "group-create-001");
  assert.notEqual(creates[0].input.operationToken, creates[1].input.operationToken);
  assert.equal(creates[0].input.guestId, guestId);
  assert.equal(creates[1].input.guestId, guestId);

  assert.equal(await ownership.get({ sessionId: "session-r2.5", tenantId: "hotel-demo", actorId: "visitor-demo", bookingId: bookingA }), creates[0].input.operationToken);
  assert.equal(await ownership.get({ sessionId: "session-r2.5", tenantId: "hotel-demo", actorId: "visitor-demo", bookingId: bookingB }), creates[1].input.operationToken);
});
