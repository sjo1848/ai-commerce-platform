import assert from "node:assert/strict";
import test from "node:test";
import { HmsServiceBindingAdapter } from "../dist/adapters/hms-service-binding.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";

const hotelA = "10000000-0000-0000-0000-000000000001";
const hotelB = "20000000-0000-0000-0000-000000000002";

const actor = {
  id: "visitor-1",
  type: "customer",
  roles: ["customer"],
  permissions: ["hms.availability.read", "hms.quote.read"],
};

function tenant(id) {
  return {
    id,
    slug: id,
    status: "active",
    allowedToolIds: ["hms.checkAvailability", "hms.getQuote"],
    toolPolicies: { "hms.checkAvailability": "auto", "hms.getQuote": "auto" },
  };
}

function mockService() {
  const calls = [];
  return {
    calls,
    service: {
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
            rooms: [{
              id: "room-101",
              roomNumber: "101",
              roomType: "STANDARD",
              status: "AVAILABLE",
              priceCents: 10000,
              currency: "ARS",
            }],
            traceId: context.traceId,
          },
        };
      },
      async getQuote(context, input) {
        calls.push({ method: "getQuote", context, input });
        return {
          ok: true,
          data: {
            source: "hms",
            truth: "transactional",
            hotelId: context.hotelId,
            roomId: input.roomId,
            start: input.start,
            end: input.end,
            nights: 2,
            nightlyRateCents: 10000,
            totalCents: 20000,
            currency: "ARS",
            traceId: context.traceId,
          },
        };
      },
    },
  };
}

function liveRuntime(service, routes, tenants = [tenant("tenant-a")]) {
  const adapter = new HmsServiceBindingAdapter(service, routes);
  return new AgentCoreRuntime({
    tenants,
    tools: [adapter.checkAvailabilityTool(), adapter.getQuoteTool()],
    now: () => new Date("2026-08-29T18:00:00.000Z"),
  });
}

test("trusted tenant route determines the HMS hotel and user input cannot override it", async () => {
  const mock = mockService();
  const runtime = liveRuntime(mock.service, { "tenant-a": { hotelId: hotelA } });
  const context = runtime.createContext({ tenantId: "tenant-a", actor, channel: "webchat", requestId: "trace-a" });

  const result = await runtime.executor.execute(
    "hms.checkAvailability",
    {
      checkIn: "2026-09-10",
      checkOut: "2026-09-12",
      guests: 4,
      hotelId: hotelB,
    },
    context,
  );

  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].context.tenantId, "tenant-a");
  assert.equal(mock.calls[0].context.hotelId, hotelA);
  assert.equal(mock.calls[0].context.traceId, "trace-a");
  assert.equal(result.requestedGuests, 4);
  assert.equal(result.capacityFilterApplied, false);
  assert.equal(result.capacityMode, "not_modeled");
});

test("different platform tenants route to different HMS hotels without tool input choosing the hotel", async () => {
  const mock = mockService();
  const runtime = liveRuntime(
    mock.service,
    { "tenant-a": { hotelId: hotelA }, "tenant-b": { hotelId: hotelB } },
    [tenant("tenant-a"), tenant("tenant-b")],
  );

  const contextA = runtime.createContext({ tenantId: "tenant-a", actor, channel: "webchat", requestId: "trace-a" });
  const contextB = runtime.createContext({ tenantId: "tenant-b", actor: { ...actor, id: "visitor-2" }, channel: "webchat", requestId: "trace-b" });

  await runtime.executor.execute("hms.checkAvailability", { checkIn: "2026-09-10", checkOut: "2026-09-12", guests: 1 }, contextA);
  await runtime.executor.execute("hms.checkAvailability", { checkIn: "2026-09-10", checkOut: "2026-09-12", guests: 1 }, contextB);

  assert.deepEqual(mock.calls.map((call) => call.context.hotelId), [hotelA, hotelB]);
});

test("missing trusted tenant route fails closed before RPC", async () => {
  const mock = mockService();
  const runtime = liveRuntime(mock.service, {});
  const context = runtime.createContext({ tenantId: "tenant-a", actor, channel: "webchat" });

  await assert.rejects(
    runtime.executor.execute("hms.checkAvailability", { checkIn: "2026-09-10", checkOut: "2026-09-12", guests: 1 }, context),
    (error) => error?.code === "FORBIDDEN" && error?.status === 403,
  );
  assert.equal(mock.calls.length, 0);
});

test("HMS structured conflict remains a normalized Core conflict", async () => {
  const service = {
    async checkAvailability() {
      return { ok: false, error: { code: "CONFLICT", message: "Inventory changed", traceId: "trace-x" } };
    },
    async getQuote() {
      return { ok: false, error: { code: "CONFLICT", message: "Room is unavailable", traceId: "trace-x" } };
    },
  };
  const runtime = liveRuntime(service, { "tenant-a": { hotelId: hotelA } });
  const context = runtime.createContext({ tenantId: "tenant-a", actor, channel: "webchat" });

  await assert.rejects(
    runtime.executor.execute("hms.getQuote", { roomId: "room-101", checkIn: "2026-09-10", checkOut: "2026-09-12" }, context),
    (error) => error?.code === "CONFLICT" && error?.status === 409 && error?.message === "Room is unavailable",
  );
});

test("fixed deployment tenant ignores a forged x-tenant-id header", async () => {
  const fakeRuntime = new AgentCoreRuntime({
    tenants: [tenant("tenant-a"), { ...tenant("tenant-b"), allowedToolIds: [] }],
    now: () => new Date("2026-08-29T18:00:00.000Z"),
  });
  const handler = createWebchatHandler(fakeRuntime, { fixedTenantId: "tenant-a" });
  const response = await handler(new Request("https://agent.example/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-b",
      "x-actor-id": "visitor-1",
    },
    body: JSON.stringify({ message: "disponibilidad 2026-09-10 a 2026-09-12 para 2 personas" }),
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.rooms));
});
