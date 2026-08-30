import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { hmsAgentTools } from "../dist/adapters/hms-agent-tools.js";
import { InMemoryReservationOperationStore } from "../dist/core/reservation-operation-store.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const roomId = "11000000-0000-0000-0000-000000000001";
const trustedGuestId = "12000000-0000-0000-0000-000000000001";
const forgedGuestId = "12000000-0000-0000-0000-999999999999";

function service() {
  return {
    async checkAvailability() { throw new Error("not used"); },
    async getQuote() { throw new Error("not used"); },
    async createReservation(context, input) {
      return {
        ok: true,
        data: {
          source: "hms",
          truth: "transactional",
          hotelId: context.hotelId,
          bookingId: "13000000-0000-0000-0000-000000000001",
          guestId: input.guestId,
          roomId: input.roomId,
          start: input.start,
          end: input.end,
          status: "CONFIRMED",
          totalCents: 20000,
          currency: "ARS",
          replayed: false,
          traceId: context.traceId,
        },
      };
    },
    async cancelReservation() { throw new Error("not used"); },
  };
}

function setup() {
  const adapter = new HmsServiceBindingAdapter(
    service(),
    { "hotel-demo": { hotelId } },
    new InMemoryReservationOperationStore(),
  );
  const tools = hmsAgentTools(adapter, { guestIdByActor: { "visitor-demo": trustedGuestId } });
  const tenant = {
    id: "hotel-demo",
    slug: "hotel-demo",
    status: "active",
    allowedToolIds: tools.map((tool) => tool.id),
    toolPolicies: { "hms.createReservation": "approval" },
  };
  const actor = {
    id: "visitor-demo",
    type: "customer",
    roles: ["customer"],
    permissions: ["hms.reservation.write"],
  };
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools, now: () => new Date("2026-08-30T14:30:00.000Z") });
  return { runtime, tools, actor };
}

test("guestId is absent from model-visible reservation schema", () => {
  const { tools } = setup();
  const reservation = tools.find((tool) => tool.id === "hms.createReservation");
  assert.ok(reservation);
  assert.equal(Object.hasOwn(reservation.inputSchema.properties, "guestId"), false);
  assert.deepEqual(reservation.inputSchema.required, ["roomId", "checkIn", "checkOut"]);
});

test("reservation canonicalization injects trusted guest identity before approval fingerprint", async () => {
  const { runtime, actor } = setup();
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor, channel: "webchat", requestId: "identity-canonical" });
  const raw = { roomId, checkIn: "2034-02-10", checkOut: "2034-02-12" };

  await assert.rejects(
    runtime.executor.execute("hms.createReservation", raw, context, { idempotencyKey: "identity-op" }),
    (error) => {
      assert.equal(error?.code, "APPROVAL_REQUIRED");
      assert.equal(error?.plan?.toolId, "hms.createReservation");
      assert.equal(error?.plan?.input?.guestId, trustedGuestId);
      assert.equal(error?.plan?.input?.roomId, roomId);
      return true;
    },
  );
});

test("request/model cannot select a different guest identity", async () => {
  const { runtime, actor } = setup();
  const context = await runtime.createContext({ tenantId: "hotel-demo", actor, channel: "webchat", requestId: "identity-forged" });
  await assert.rejects(
    runtime.executor.execute(
      "hms.createReservation",
      { guestId: forgedGuestId, roomId, checkIn: "2034-02-10", checkOut: "2034-02-12" },
      context,
      { idempotencyKey: "identity-forged-op" },
    ),
    (error) => error?.code === "BAD_REQUEST" && /identity cannot be selected/i.test(error?.message ?? ""),
  );
  assert.equal(runtime.audit.events.at(-1)?.detail, "input_validation");
});
