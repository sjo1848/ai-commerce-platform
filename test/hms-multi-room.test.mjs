import test from "node:test";
import assert from "node:assert/strict";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { hmsAgentTools } from "../dist/adapters/hms-agent-tools.js";
import { InMemoryReservationOperationStore } from "../dist/core/reservation-operation-store.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const trustedGuestId = "12000000-0000-0000-0000-000000000001";
const room101 = "11000000-0000-0000-0000-000000000101";
const room102 = "11000000-0000-0000-0000-000000000102";

function reservationData(context, input, bookingId, status = "CONFIRMED", replayed = false) {
  return {
    source: "hms",
    truth: "transactional",
    hotelId: context.hotelId,
    bookingId,
    guestId: input.guestId ?? trustedGuestId,
    roomId: input.roomId,
    start: input.start ?? "2034-02-10",
    end: input.end ?? "2034-02-12",
    status,
    totalCents: 20000,
    currency: "ARS",
    replayed,
    traceId: context.traceId,
  };
}

function setup({ failRoomId, failCompensation = false } = {}) {
  const calls = { creates: [], cancels: [] };
  const service = {
    async checkAvailability() { throw new Error("not used"); },
    async getQuote() { throw new Error("not used"); },
    async createReservation(context, input) {
      calls.creates.push({ ...input });
      if (input.roomId === failRoomId) {
        return { ok: false, error: { code: "CONFLICT", message: "room unavailable", traceId: context.traceId } };
      }
      const suffix = input.roomId === room101 ? "101" : "102";
      return { ok: true, data: reservationData(context, input, `13000000-0000-0000-0000-000000000${suffix}`) };
    },
    async cancelReservation(context, input) {
      calls.cancels.push({ ...input });
      if (failCompensation) {
        return { ok: false, error: { code: "INTERNAL_ERROR", message: "cancel failed", traceId: context.traceId } };
      }
      const created = calls.creates.find((item) => item.operationToken === input.operationToken);
      return { ok: true, data: reservationData(context, { guestId: trustedGuestId, roomId: created?.roomId ?? room101 }, input.bookingId, "CANCELLED") };
    },
  };
  const ownership = new InMemoryReservationOperationStore();
  const adapter = new HmsServiceBindingAdapter(service, { "hotel-demo": { hotelId } }, ownership);
  const identity = { guestIdByTenantActor: { "hotel-demo": { "visitor-demo": trustedGuestId } } };
  const tools = hmsAgentTools(adapter, identity);
  const tenant = {
    id: "hotel-demo",
    slug: "hotel-demo",
    status: "active",
    allowedToolIds: tools.map((tool) => tool.id),
    toolPolicies: { "hms.createReservationBundle": "approval" },
  };
  const actor = {
    id: "visitor-demo",
    type: "customer",
    roles: ["customer"],
    permissions: ["hms.reservation.write"],
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools, now: () => new Date("2026-08-30T14:30:00.000Z") });
  return { runtime, actor, tools, ownership, calls };
}

async function approval(runtime, actor, raw, key) {
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor, channel: "webchat", requestId: `approval-${key}` });
  let fingerprint;
  await assert.rejects(
    runtime.executor.execute("hms.createReservationBundle", raw, context, { idempotencyKey: key }),
    (error) => {
      assert.equal(error?.code, "APPROVAL_REQUIRED");
      assert.equal(error?.plan?.toolId, "hms.createReservationBundle");
      assert.equal(error?.plan?.input?.guestId, trustedGuestId);
      assert.deepEqual(error?.plan?.input?.roomIds, raw.roomIds);
      fingerprint = error?.operationFingerprint;
      return typeof fingerprint === "string" && fingerprint.length > 0;
    },
  );
  return { context, fingerprint };
}

test("bundle schema is model-visible without guest identity and exact bundle is approval-bound", async () => {
  const { runtime, actor, tools, calls } = setup();
  const bundle = tools.find((tool) => tool.id === "hms.createReservationBundle");
  assert.ok(bundle);
  assert.equal(Object.hasOwn(bundle.inputSchema.properties, "guestId"), false);
  assert.deepEqual(bundle.inputSchema.required, ["roomIds", "checkIn", "checkOut"]);

  const raw = {
    roomIds: [room102, room101],
    checkIn: "2034-02-10",
    checkOut: "2034-02-12",
    allocations: [
      { roomId: room102, guests: 3 },
      { roomId: room101, guests: 2 },
    ],
  };
  const { context, fingerprint } = await approval(runtime, actor, raw, "bundle-parent");
  const result = await runtime.executor.execute("hms.createReservationBundle", raw, context, {
    idempotencyKey: "bundle-parent",
    humanApproved: true,
    approvedOperationFingerprint: fingerprint,
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.bookings.length, 2);
  assert.deepEqual(calls.creates.map((call) => call.roomId), [room102, room101]);
  assert.deepEqual(calls.creates.map((call) => call.operationToken), ["bundle-parent:room:1", "bundle-parent:room:2"]);
  assert.ok(calls.creates.every((call) => call.guestId === trustedGuestId));
  assert.match(calls.creates[0].notes, /3 huéspedes/i);
  assert.match(calls.creates[0].notes, /no valida capacidad/i);
});

test("bundle approval fingerprint changes when the exact room bundle changes", async () => {
  const { runtime, actor } = setup();
  const first = await approval(runtime, actor, { roomIds: [room101, room102], checkIn: "2034-02-10", checkOut: "2034-02-12" }, "bundle-fingerprint-a");
  const second = await approval(runtime, actor, { roomIds: [room102, room101], checkIn: "2034-02-10", checkOut: "2034-02-12" }, "bundle-fingerprint-b");
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("bundle partial create failure compensates prior room and never reports partial confirmation", async () => {
  const { runtime, actor, calls } = setup({ failRoomId: room101 });
  const raw = { roomIds: [room102, room101], checkIn: "2034-02-10", checkOut: "2034-02-12" };
  const { context, fingerprint } = await approval(runtime, actor, raw, "bundle-compensate");
  const result = await runtime.executor.execute("hms.createReservationBundle", raw, context, {
    idempotencyKey: "bundle-compensate",
    humanApproved: true,
    approvedOperationFingerprint: fingerprint,
  });

  assert.equal(result.status, "FAILED_COMPENSATED");
  assert.deepEqual(result.bookings, []);
  assert.equal(result.failedRoomId, room101);
  assert.equal(calls.cancels.length, 1);
  assert.equal(calls.cancels[0].operationToken, "bundle-compensate:room:1");
  assert.deepEqual(result.compensatedBookingIds, ["13000000-0000-0000-0000-000000000102"]);
});

test("bundle partial failure with failed compensation fails closed as an exceptional state", async () => {
  const { runtime, actor, calls } = setup({ failRoomId: room101, failCompensation: true });
  const raw = { roomIds: [room102, room101], checkIn: "2034-02-10", checkOut: "2034-02-12" };
  const { context, fingerprint } = await approval(runtime, actor, raw, "bundle-compensation-fails");
  await assert.rejects(
    runtime.executor.execute("hms.createReservationBundle", raw, context, {
      idempotencyKey: "bundle-compensation-fails",
      humanApproved: true,
      approvedOperationFingerprint: fingerprint,
    }),
    (error) => error?.code === "TOOL_EXECUTION_FAILED" && /compensation was incomplete/i.test(error?.message ?? ""),
  );
  assert.equal(calls.cancels.length, 1);
});

test("request cannot forge guest identity for multi-room bundle", async () => {
  const { runtime, actor } = setup();
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor, channel: "webchat", requestId: "forged-bundle" });
  await assert.rejects(
    runtime.executor.execute("hms.createReservationBundle", {
      guestId: "12000000-0000-0000-0000-999999999999",
      roomIds: [room101, room102],
      checkIn: "2034-02-10",
      checkOut: "2034-02-12",
    }, context, { idempotencyKey: "forged-bundle" }),
    (error) => error?.code === "BAD_REQUEST" && /identity cannot be selected/i.test(error?.message ?? ""),
  );
});
