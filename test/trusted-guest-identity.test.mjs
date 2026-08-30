import test from "node:test";
import assert from "node:assert/strict";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { hmsAgentTools } from "../dist/adapters/hms-agent-tools.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";

const hotelId = "10000000-0000-0000-0000-000000000001";
const trustedGuestId = "12000000-0000-0000-0000-000000000001";
const attackerGuestId = "12000000-0000-0000-0000-000000000999";
const roomId = "11000000-0000-0000-0000-000000000001";
const actor = { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.reservation.write"] };
const tenant = {
  id: "hotel-demo", slug: "hotel-demo", status: "active",
  allowedToolIds: ["hms.createReservation"],
  toolPolicies: { "hms.createReservation": "approval" },
};

function setup() {
  const calls = [];
  const service = {
    async checkAvailability() { throw new Error("unused"); },
    async getQuote() { throw new Error("unused"); },
    async createReservation(context, input) {
      calls.push({ context, input });
      return { ok: true, data: { source: "hms", truth: "transactional", hotelId, bookingId: "13000000-0000-0000-0000-000000000001", guestId: input.guestId, roomId: input.roomId, start: input.start, end: input.end, status: "CONFIRMED", totalCents: 10000, currency: "ARS", replayed: false, traceId: context.traceId } };
    },
    async cancelReservation() { throw new Error("unused"); },
  };
  const reservationOperations = { async bind() {}, async get() { return undefined; } };
  const adapter = new HmsServiceBindingAdapter(service, { "hotel-demo": { hotelId } }, reservationOperations);
  const tools = hmsAgentTools(adapter, { guestIdByTenantActor: { "hotel-demo": { "visitor-demo": trustedGuestId } } });
  const runtime = new AgentCoreRuntime({ tenants: [tenant], tools });
  return { runtime, calls };
}

test("model-visible reservation schema contains no guestId", () => {
  const { runtime } = setup();
  const descriptor = runtime.registry.descriptorsFor(tenant).find((tool) => tool.id === "hms.createReservation");
  assert.ok(descriptor);
  assert.equal(Object.hasOwn(descriptor.inputSchema.properties, "guestId"), false);
  assert.deepEqual(descriptor.inputSchema.required, ["roomId", "checkIn", "checkOut"]);
});

test("canonical approval plan includes server-resolved tenant+actor guest identity", async () => {
  const { runtime } = setup();
  const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  const input = { roomId, checkIn: "2034-02-10", checkOut: "2034-02-12" };
  await assert.rejects(
    runtime.executor.execute("hms.createReservation", input, context, { idempotencyKey: "op-1" }),
    (error) => {
      assert.equal(error.code, "APPROVAL_REQUIRED");
      assert.equal(error.plan.input.guestId, trustedGuestId);
      assert.equal(error.plan.input.roomId, roomId);
      return true;
    },
  );
});

test("request cannot select another guest identity", async () => {
  const { runtime, calls } = setup();
  const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  await assert.rejects(
    runtime.executor.execute("hms.createReservation", { guestId: attackerGuestId, roomId, checkIn: "2034-02-10", checkOut: "2034-02-12" }, context, { idempotencyKey: "op-2" }),
    (error) => error?.code === "BAD_REQUEST",
  );
  assert.equal(calls.length, 0);
});
