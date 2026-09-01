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

function context() {
  return {
    requestId: "critic-uncertain-compensation",
    now: "2026-09-01T02:10:00.000Z",
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
      id: "session-critic-compensation",
      tenantId: "hotel-demo",
      actorId: "visitor-demo",
      channel: "webchat",
      createdAt: "2026-09-01T02:00:00.000Z",
      expiresAt: "2026-09-01T03:00:00.000Z",
    },
  };
}

function hmsWithUncertainCompensation() {
  const createByToken = new Map();
  const active = new Set();
  let availabilityReads = 0;
  let compensationThrows = 2;

  return {
    active,
    service: {
      async checkAvailability(ctx, input) {
        availabilityReads += 1;
        const rooms = availabilityReads <= 2
          ? [roomA, roomB]
          : [roomA];
        return {
          ok: true,
          data: {
            source: "hms",
            truth: "transactional",
            hotelId: ctx.hotelId,
            start: input.start,
            end: input.end,
            capacityMode: "not_modeled",
            rooms: rooms.map((id) => ({
              id,
              roomNumber: id === roomA ? "101" : "102",
              roomType: "DOUBLE",
              status: "AVAILABLE",
              priceCents: 10000,
              currency: "ARS",
            })),
            traceId: ctx.traceId,
          },
        };
      },
      async getQuote() { throw new Error("not used"); },
      async createReservation(ctx, input) {
        const replay = createByToken.get(input.operationToken);
        if (replay) return { ok: true, data: { ...replay, replayed: true } };
        if (input.roomId === roomB) {
          return { ok: false, error: { code: "CONFLICT", message: "room B became unavailable", traceId: ctx.traceId } };
        }
        const result = {
          source: "hms",
          truth: "transactional",
          hotelId: ctx.hotelId,
          bookingId: bookingA,
          guestId: input.guestId,
          roomId: input.roomId,
          start: input.start,
          end: input.end,
          status: "CONFIRMED",
          totalCents: 10000,
          currency: "ARS",
          replayed: false,
          traceId: ctx.traceId,
        };
        createByToken.set(input.operationToken, result);
        active.add(bookingA);
        return { ok: true, data: result };
      },
      async cancelReservation(ctx, input) {
        // The compensation reaches HMS and commits, but both the original
        // response and the exact-token reconciliation response are lost.
        active.delete(input.bookingId);
        if (compensationThrows > 0) {
          compensationThrows -= 1;
          throw new Error("compensation response lost after commit");
        }
        return {
          ok: true,
          data: {
            source: "hms",
            truth: "transactional",
            hotelId: ctx.hotelId,
            bookingId: input.bookingId,
            guestId,
            roomId: roomA,
            start: "2027-02-10",
            end: "2027-02-12",
            status: "CANCELLED",
            totalCents: 10000,
            currency: "ARS",
            replayed: true,
            traceId: ctx.traceId,
          },
        };
      },
    },
  };
}

test("Independent Critic P1: uncertain compensation must disable automatic replay of the original create plan", async () => {
  const mock = hmsWithUncertainCompensation();
  const adapter = new HmsServiceBindingAdapter(
    mock.service,
    { "hotel-demo": { hotelId } },
    new InMemoryReservationOperationStore(),
  );
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

  let caught;
  try {
    await tool.execute(canonical.value, context(), {
      idempotencyKey: "critic-compensation-root",
      humanApproved: true,
      recoveryAttempt: 0,
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof CoreError);
  assert.equal(caught.code, "OUTCOME_UNKNOWN");
  assert.equal(mock.active.has(bookingA), false, "the compensation may already have committed in HMS");
  assert.equal(
    caught.automaticRecoveryAllowed,
    false,
    "replaying the original CREATE plan is unsafe after an uncertain compensation because CREATE replay only proves the historical create result, not current active state",
  );
});
