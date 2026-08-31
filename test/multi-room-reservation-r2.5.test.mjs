import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { CoreError } from "../dist/core/errors.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { operationFingerprint } from "../dist/core/operation-fingerprint.js";
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

function rpcError(code, message) {
  return { ok: false, error: { code, message, traceId: "r2.5-create" } };
}

function mockService({ failCreateRoom, failCancelBooking } = {}) {
  const calls = [];
  return {
    calls,
    service: {
      async checkAvailability() { throw new Error("not used"); },
      async getQuote() { throw new Error("not used"); },
      async createReservation(ctx, input) {
        calls.push({ method: "createReservation", ctx, input });
        if (input.roomId === failCreateRoom) return rpcError("CONFLICT", `room ${input.roomId} unavailable`);
        const bookingId = input.roomId === roomA ? bookingA : bookingB;
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: ctx.hotelId, bookingId, guestId: input.guestId, roomId: input.roomId, start: input.start, end: input.end, status: "CONFIRMED", totalCents: 10000, currency: "ARS", replayed: false, traceId: ctx.traceId } };
      },
      async cancelReservation(ctx, input) {
        calls.push({ method: "cancelReservation", ctx, input });
        if (input.bookingId === failCancelBooking) return rpcError("INTERNAL_ERROR", `cannot cancel ${input.bookingId}`);
        const roomId = input.bookingId === bookingA ? roomA : roomB;
        return { ok: true, data: { source: "hms", truth: "transactional", hotelId: ctx.hotelId, bookingId: input.bookingId, guestId, roomId, start: "2027-02-10", end: "2027-02-12", status: "CANCELLED", totalCents: 10000, currency: "ARS", replayed: false, traceId: ctx.traceId } };
      },
    },
  };
}

function setup(options = {}) {
  const mock = mockService(options);
  const ownership = options.ownership ?? new InMemoryReservationOperationStore();
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
  assert.deepEqual(result.createdBookingIds, [bookingA, bookingB]);
  assert.deepEqual(result.compensatedBookingIds, []);
  const creates = mock.calls.filter((call) => call.method === "createReservation");
  assert.equal(creates.length, 2);
  assert.notEqual(creates[0].input.operationToken, "group-create-001");
  assert.notEqual(creates[1].input.operationToken, "group-create-001");
  assert.notEqual(creates[0].input.operationToken, creates[1].input.operationToken);
  assert.match(creates[0].input.operationToken, /^r25c_[0-9a-f]{64}$/);
  assert.match(creates[1].input.operationToken, /^r25c_[0-9a-f]{64}$/);
  assert.equal(creates[0].input.guestId, guestId);
  assert.equal(creates[1].input.guestId, guestId);

  assert.equal(await ownership.get({ sessionId: "session-r2.5", tenantId: "hotel-demo", actorId: "visitor-demo", bookingId: bookingA }), creates[0].input.operationToken);
  assert.equal(await ownership.get({ sessionId: "session-r2.5", tenantId: "hotel-demo", actorId: "visitor-demo", bookingId: bookingB }), creates[1].input.operationToken);
});

test("R2.5 child operation tokens are deterministic for the exact root plan", async () => {
  const first = setup();
  const second = setup();
  await first.adapter.createMultiReservationTool().execute(validInput, context(), { idempotencyKey: "same-root" });
  await second.adapter.createMultiReservationTool().execute(validInput, context(), { idempotencyKey: "same-root" });
  const firstTokens = first.mock.calls.filter((call) => call.method === "createReservation").map((call) => call.input.operationToken);
  const secondTokens = second.mock.calls.filter((call) => call.method === "createReservation").map((call) => call.input.operationToken);
  assert.deepEqual(firstTokens, secondTokens);
});

test("R2.5 failure after one child compensates the successful child with its original token", async () => {
  const { adapter, mock } = setup({ failCreateRoom: roomB });
  const result = await adapter.createMultiReservationTool().execute(validInput, context(), { idempotencyKey: "partial-compensate" });

  assert.equal(result.outcome, "compensated");
  assert.deepEqual(result.createdBookingIds, [bookingA]);
  assert.deepEqual(result.compensatedBookingIds, [bookingA]);
  assert.deepEqual(result.bookingIds, []);
  assert.equal(result.failedRoomId, roomB);

  const createA = mock.calls.find((call) => call.method === "createReservation" && call.input.roomId === roomA);
  const cancelA = mock.calls.find((call) => call.method === "cancelReservation" && call.input.bookingId === bookingA);
  assert.ok(createA);
  assert.ok(cancelA);
  assert.equal(cancelA.input.operationToken, createA.input.operationToken, "compensation must use the original trusted child create token");
  assert.equal(mock.calls.filter((call) => call.method === "createReservation").length, 2);
  assert.equal(mock.calls.filter((call) => call.method === "cancelReservation").length, 1);
});

test("R2.5 compensation failure is explicit and preserves the surviving active booking", async () => {
  const { adapter, mock } = setup({ failCreateRoom: roomB, failCancelBooking: bookingA });
  const result = await adapter.createMultiReservationTool().execute(validInput, context(), { idempotencyKey: "partial-compensation-fails" });

  assert.equal(result.outcome, "compensation_failed");
  assert.deepEqual(result.createdBookingIds, [bookingA]);
  assert.deepEqual(result.compensatedBookingIds, []);
  assert.deepEqual(result.bookingIds, [bookingA]);
  assert.equal(result.failedRoomId, roomB);
  assert.equal(mock.calls.filter((call) => call.method === "cancelReservation").length, 1);
});

test("R2.5 failure before the first child does not attempt compensation", async () => {
  const { adapter, mock } = setup({ failCreateRoom: roomA });
  await assert.rejects(
    () => adapter.createMultiReservationTool().execute(validInput, context(), { idempotencyKey: "fail-first" }),
    (error) => error instanceof CoreError && error.code === "CONFLICT",
  );
  assert.equal(mock.calls.filter((call) => call.method === "createReservation").length, 1);
  assert.equal(mock.calls.filter((call) => call.method === "cancelReservation").length, 0);
});

test("R2.5 ownership binding failure after downstream create triggers compensation for every created child", async () => {
  const backing = new InMemoryReservationOperationStore();
  let binds = 0;
  const ownership = {
    async bind(input) {
      binds += 1;
      if (binds === 2) throw new Error("durable ownership write failed");
      return backing.bind(input);
    },
    get(input) { return backing.get(input); },
  };
  const { adapter, mock } = setup({ ownership });
  const result = await adapter.createMultiReservationTool().execute(validInput, context(), { idempotencyKey: "ownership-failure" });

  assert.equal(result.outcome, "compensated");
  assert.deepEqual(result.createdBookingIds, [bookingA, bookingB]);
  assert.deepEqual(result.compensatedBookingIds, [bookingA, bookingB]);
  assert.deepEqual(result.bookingIds, []);
  assert.equal(mock.calls.filter((call) => call.method === "cancelReservation").length, 2);
});

test("R2.5 Core idempotency replays the composite result without duplicate child side effects", async () => {
  const { adapter, mock } = setup();
  const tool = adapter.createMultiReservationTool();
  const runtime = new AgentCoreRuntime({
    tenants: [{
      id: "hotel-demo", slug: "hotel-demo", status: "active",
      allowedToolIds: [tool.id],
      toolPolicies: { [tool.id]: "approval" },
    }],
    tools: [tool],
    now: () => new Date("2026-08-31T22:00:00.000Z"),
  });
  const ctx = await runtime.createContext({
    tenantId: "hotel-demo",
    actor: { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.reservation.write"] },
    channel: "webchat",
    requestId: "r2.5-core-idem",
  });
  const fingerprint = await operationFingerprint(tool.id, validInput);
  const meta = { idempotencyKey: "composite-core-replay", humanApproved: true, approvedOperationFingerprint: fingerprint };

  const first = await runtime.executor.execute(tool.id, validInput, ctx, meta);
  const second = await runtime.executor.execute(tool.id, validInput, ctx, meta);
  assert.deepEqual(second, first);
  assert.equal(mock.calls.filter((call) => call.method === "createReservation").length, 2, "Core replay must not execute two more child creates");
  assert.equal(mock.calls.filter((call) => call.method === "cancelReservation").length, 0);
});
