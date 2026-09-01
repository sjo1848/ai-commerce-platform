import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { CoreError } from "../dist/core/errors.js";
import { InMemoryReservationOperationStore } from "../dist/core/reservation-operation-store.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const bookingA = "13000000-0000-0000-0000-000000000101";
const bookingB = "13000000-0000-0000-0000-000000000102";
const roomA = "11000000-0000-0000-0000-000000000101";
const roomB = "11000000-0000-0000-0000-000000000102";
const tokenA = "trusted-create-a";
const tokenB = "trusted-create-b";

function context() {
  return {
    requestId: "r2.5-cancel",
    now: "2026-08-31T22:00:00.000Z",
    tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: ["hms.cancelMultiReservation"] },
    actor: { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.reservation.cancel"] },
    session: { id: "session-r2.5", tenantId: "hotel-demo", actorId: "visitor-demo", channel: "webchat", createdAt: "2026-08-31T22:00:00.000Z", expiresAt: "2026-09-01T22:00:00.000Z" },
  };
}

function mockService({ failCancelBooking, uncertainCancelBooking, uncertainCancelAttempts = 0 } = {}) {
  const calls = [];
  let uncertainCount = 0;
  return {
    calls,
    service: {
      async checkAvailability() { throw new Error("not used"); },
      async getQuote() { throw new Error("not used"); },
      async createReservation() { throw new Error("not used"); },
      async cancelReservation(ctx, input) {
        calls.push({ method: "cancelReservation", ctx, input });
        if (input.bookingId === uncertainCancelBooking && uncertainCount < uncertainCancelAttempts) {
          uncertainCount += 1;
          throw new Error("transport timeout after dispatch");
        }
        if (input.bookingId === failCancelBooking) {
          return { ok: false, error: { code: "INTERNAL_ERROR", message: "downstream cancellation failed", traceId: ctx.traceId } };
        }
        const roomId = input.bookingId === bookingA ? roomA : roomB;
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: ctx.hotelId, bookingId: input.bookingId, guestId: "guest", roomId, start: "2027-02-10", end: "2027-02-12", status: "CANCELLED", totalCents: 10000, currency: "ARS", replayed: uncertainCount > 0, traceId: ctx.traceId } };
      },
    },
  };
}

async function setup(options = {}) {
  const mock = mockService(options);
  const ownership = new InMemoryReservationOperationStore();
  if (options.bindA !== false) {
    await ownership.bind({ sessionId: "session-r2.5", tenantId: "hotel-demo", actorId: "visitor-demo", bookingId: bookingA, operationToken: tokenA });
  }
  if (options.bindB !== false) {
    await ownership.bind({ sessionId: "session-r2.5", tenantId: "hotel-demo", actorId: "visitor-demo", bookingId: bookingB, operationToken: tokenB });
  }
  const adapter = new HmsServiceBindingAdapter(mock.service, { "hotel-demo": { hotelId } }, ownership);
  return { mock, ownership, adapter };
}

test("R2.5 exposes group cancellation as Core-idempotent irreversible cancellation", async () => {
  const { adapter } = await setup();
  const tool = adapter.cancelMultiReservationTool();
  assert.equal(tool.id, "hms.cancelMultiReservation");
  assert.equal(tool.primitive, "CANCEL");
  assert.equal(tool.risk, "write");
  assert.equal(tool.sideEffect, "irreversible");
  assert.equal(tool.idempotencyMode, "core");
  assert.deepEqual(tool.requiredPermissions, ["hms.reservation.cancel"]);
  assert.equal(tool.validateInput({ bookingIds: [bookingA] }).ok, false);
  assert.equal(tool.validateInput({ bookingIds: [bookingA, bookingA] }).ok, false);
});

test("R2.5 group cancellation pre-verifies ownership of every booking before the first side effect", async () => {
  const { adapter, mock } = await setup({ bindB: false });
  await assert.rejects(
    () => adapter.cancelMultiReservationTool().execute({ bookingIds: [bookingA, bookingB] }, context(), { idempotencyKey: "cancel-group-unowned" }),
    (error) => error instanceof CoreError && error.code === "FORBIDDEN",
  );
  assert.equal(mock.calls.length, 0, "no downstream cancellation may start before complete ownership verification");
});

test("R2.5 successful group cancellation uses each original trusted create token", async () => {
  const { adapter, mock } = await setup();
  const result = await adapter.cancelMultiReservationTool().execute({ bookingIds: [bookingA, bookingB] }, context(), { idempotencyKey: "cancel-group-success" });

  assert.equal(result.outcome, "cancelled");
  assert.deepEqual(result.bookingIds, []);
  assert.deepEqual(result.cancelledBookingIds, [bookingA, bookingB]);
  assert.deepEqual(result.failedBookingIds, []);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].input.operationToken, tokenA);
  assert.equal(mock.calls[1].input.operationToken, tokenB);
  assert.notEqual(mock.calls[0].input.operationToken, "cancel-group-success");
  assert.notEqual(mock.calls[1].input.operationToken, "cancel-group-success");
});

test("R2.5 cancellation reconciles one uncertain response with the exact original create token", async () => {
  const { adapter, mock } = await setup({ uncertainCancelBooking: bookingA, uncertainCancelAttempts: 1 });
  const result = await adapter.cancelMultiReservationTool().execute({ bookingIds: [bookingA, bookingB] }, context(), { idempotencyKey: "cancel-group-reconcile" });

  assert.equal(result.outcome, "cancelled");
  const callsA = mock.calls.filter((call) => call.input.bookingId === bookingA);
  assert.equal(callsA.length, 2);
  assert.equal(callsA[0].input.operationToken, tokenA);
  assert.equal(callsA[1].input.operationToken, tokenA);
  assert.deepEqual(mock.calls.filter((call) => call.input.bookingId === bookingB).map((call) => call.input.operationToken), [tokenB]);
});

test("R2.5 repeated cancellation uncertainty returns OUTCOME_UNKNOWN and does not mutate later bookings", async () => {
  const { adapter, mock } = await setup({ uncertainCancelBooking: bookingA, uncertainCancelAttempts: 2 });
  await assert.rejects(
    () => adapter.cancelMultiReservationTool().execute({ bookingIds: [bookingA, bookingB] }, context(), { idempotencyKey: "cancel-group-unknown" }),
    (error) => error instanceof CoreError && error.code === "OUTCOME_UNKNOWN" && error.status === 503,
  );
  const callsA = mock.calls.filter((call) => call.input.bookingId === bookingA);
  assert.equal(callsA.length, 2);
  assert.equal(callsA[0].input.operationToken, tokenA);
  assert.equal(callsA[1].input.operationToken, tokenA);
  assert.equal(mock.calls.filter((call) => call.input.bookingId === bookingB).length, 0, "later irreversible cancellations must stop after an unresolved prior mutation");
});

test("R2.5 partial group cancellation keeps only failed booking IDs active and continues deterministic cleanup", async () => {
  const { adapter, mock } = await setup({ failCancelBooking: bookingB });
  const result = await adapter.cancelMultiReservationTool().execute({ bookingIds: [bookingA, bookingB] }, context(), { idempotencyKey: "cancel-group-partial" });

  assert.equal(result.outcome, "partial_failure");
  assert.deepEqual(result.cancelledBookingIds, [bookingA]);
  assert.deepEqual(result.failedBookingIds, [bookingB]);
  assert.deepEqual(result.bookingIds, [bookingB]);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].input.operationToken, tokenA);
  assert.equal(mock.calls[1].input.operationToken, tokenB);
});
