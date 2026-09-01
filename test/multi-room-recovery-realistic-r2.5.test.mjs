import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { hmsAgentTools } from "../dist/adapters/hms-agent-tools.js";
import { CoreError } from "../dist/core/errors.js";
import { InMemoryReservationOperationStore } from "../dist/core/reservation-operation-store.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const guestId = "12000000-0000-0000-0000-000000000001";
const roomA = "11000000-0000-0000-0000-000000000101";
const roomB = "11000000-0000-0000-0000-000000000102";
const bookingA = "13000000-0000-0000-0000-000000000101";
const bookingB = "13000000-0000-0000-0000-000000000102";

function context() {
  return {
    requestId: "r2.5-realistic-recovery",
    now: "2026-09-01T00:00:00.000Z",
    tenant: {
      id: "hotel-demo",
      slug: "hotel-demo",
      status: "active",
      allowedToolIds: ["hms.createMultiReservation"],
      toolPolicies: { "hms.createMultiReservation": "approval" },
    },
    actor: {
      id: "visitor-demo",
      type: "customer",
      roles: ["customer"],
      permissions: ["hms.reservation.write"],
    },
    session: {
      id: "session-r2.5-realistic-recovery",
      tenantId: "hotel-demo",
      actorId: "visitor-demo",
      channel: "webchat",
      createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-09-02T00:00:00.000Z",
    },
  };
}

function realisticHms() {
  const calls = [];
  const occupied = new Set();
  const byToken = new Map();
  let uncertainReplayThrowsRemaining = 0;

  const roomResult = (ctx, input, replayed) => {
    const bookingId = input.roomId === roomA ? bookingA : bookingB;
    return {
      source: "hms",
      truth: "transactional",
      hotelId: ctx.hotelId,
      bookingId,
      guestId: input.guestId,
      roomId: input.roomId,
      start: input.start,
      end: input.end,
      status: "CONFIRMED",
      totalCents: 10000,
      currency: "ARS",
      replayed,
      traceId: ctx.traceId,
    };
  };

  return {
    calls,
    occupied,
    service: {
      async checkAvailability(ctx, input) {
        calls.push({ method: "checkAvailability", input });
        const rooms = [roomA, roomB]
          .filter((roomId) => !occupied.has(roomId))
          .map((id) => ({ id, roomNumber: id === roomA ? "101" : "102", roomType: "DOUBLE", status: "AVAILABLE", priceCents: 10000, currency: "ARS" }));
        return {
          ok: true,
          data: {
            source: "hms", truth: "transactional", hotelId: ctx.hotelId,
            start: input.start, end: input.end, capacityMode: "not_modeled", rooms, traceId: ctx.traceId,
          },
        };
      },
      async getQuote() { throw new Error("not used"); },
      async createReservation(ctx, input) {
        calls.push({ method: "createReservation", input: structuredClone(input) });
        const existing = byToken.get(input.operationToken);
        if (existing) {
          if (existing.roomId === roomB && uncertainReplayThrowsRemaining > 0) {
            uncertainReplayThrowsRemaining -= 1;
            throw new Error("second response lost after committed mutation");
          }
          return { ok: true, data: { ...existing.result, replayed: true } };
        }
        if (occupied.has(input.roomId)) {
          return { ok: false, error: { code: "CONFLICT", message: "room unavailable", traceId: ctx.traceId } };
        }
        const result = roomResult(ctx, input, false);
        byToken.set(input.operationToken, { roomId: input.roomId, result });
        occupied.add(input.roomId);
        if (input.roomId === roomB) {
          // HMS commits B, but both the initial response and the immediate
          // exact-token reconciliation response are lost.
          uncertainReplayThrowsRemaining = 1;
          throw new Error("first response lost after committed mutation");
        }
        return { ok: true, data: result };
      },
      async cancelReservation() { throw new Error("not used"); },
    },
  };
}

test("R2.5 trusted recovery replays exact child tokens even when own committed rooms disappeared from availability", async () => {
  const mock = realisticHms();
  const ownership = new InMemoryReservationOperationStore();
  const adapter = new HmsServiceBindingAdapter(mock.service, { "hotel-demo": { hotelId } }, ownership);
  const tool = hmsAgentTools(adapter, {
    guestIdByTenantActor: { "hotel-demo": { "visitor-demo": guestId } },
  }).find((candidate) => candidate.id === "hms.createMultiReservation");
  assert.ok(tool);

  const canonical = tool.validateInput({
    roomIds: [roomA, roomB],
    checkIn: "2027-02-10",
    checkOut: "2027-02-12",
  }, context());
  assert.equal(canonical.ok, true);

  await assert.rejects(
    () => tool.execute(canonical.value, context(), {
      idempotencyKey: "same-approved-root",
      humanApproved: true,
      recoveryAttempt: 0,
    }),
    (error) => error instanceof CoreError && error.code === "OUTCOME_UNKNOWN",
  );

  assert.deepEqual([...mock.occupied].sort(), [roomA, roomB].sort(), "both HMS mutations may already have committed despite the unknown result");
  const availabilityBeforeRecovery = mock.calls.filter((call) => call.method === "checkAvailability").length;
  assert.equal(availabilityBeforeRecovery, 3, "initial execution uses aggregate plus per-child revalidation");

  const recovered = await tool.execute(canonical.value, context(), {
    idempotencyKey: "same-approved-root",
    humanApproved: true,
    recoveryAttempt: 1,
  });

  assert.equal(recovered.outcome, "confirmed");
  assert.deepEqual(recovered.bookingIds, [bookingA, bookingB]);
  assert.equal(
    mock.calls.filter((call) => call.method === "checkAvailability").length,
    availabilityBeforeRecovery,
    "trusted recovery must not reject its own already-committed rooms via availability preflight",
  );

  const creates = mock.calls.filter((call) => call.method === "createReservation");
  const aCalls = creates.filter((call) => call.input.roomId === roomA);
  const bCalls = creates.filter((call) => call.input.roomId === roomB);
  assert.equal(aCalls.length, 2);
  assert.equal(bCalls.length, 3);
  assert.equal(aCalls[0].input.operationToken, aCalls[1].input.operationToken);
  assert.ok(bCalls.every((call) => call.input.operationToken === bCalls[0].input.operationToken));
});
