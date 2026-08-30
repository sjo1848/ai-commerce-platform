import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";
import { LLMModelRouter } from "../dist/core/llm-model.js";

const context = {
  requestId: "request-demo",
  tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: [] },
  actor: { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: [] },
  session: { id: "session-demo", tenantId: "hotel-demo", actorId: "visitor-demo", channel: "webchat", createdAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z" },
  now: "2026-08-30T20:00:00-03:00",
};

function emptyState() {
  return { stay: {}, availabilityRoomIds: [], availabilityRooms: [], selectedRoomIds: [], roomGuestAllocations: {}, activeBookingIds: [] };
}
function fallback(result = { kind: "message", message: "fallback" }) {
  return { calls: 0, async route() { this.calls += 1; return result; } };
}
function provider(value) {
  return { async completeStructured() { return { value, model: "fake" }; } };
}

test("real LLM route may answer a greeting as bounded receptionist social conversation", async () => {
  const fb = fallback();
  const router = new LLMModelRouter(provider({
    kind: "message",
    toolId: "",
    input: {},
    clarificationReason: "none",
    missing: [],
    statePatch: {},
    messageMode: "social",
    messageText: "¡Hola! Bienvenido. ¿Cómo te puedo ayudar con tu estadía?",
  }), fb);
  const result = await router.route("Hola", context, [], [], emptyState());
  assert.equal(result.kind, "message");
  assert.match(result.message, /hola/i);
  assert.match(result.message, /ayudar|estadía/i);
  assert.equal(fb.calls, 0);
});

test("social route cannot smuggle price, room or availability facts", async () => {
  const fb = fallback({ kind: "message", message: "¡Hola! Bienvenido. ¿En qué te puedo ayudar con tu estadía?" });
  const router = new LLMModelRouter(provider({
    kind: "message",
    toolId: "",
    input: {},
    clarificationReason: "none",
    missing: [],
    statePatch: {},
    messageMode: "social",
    messageText: "Hola, la habitación 101 está disponible y sale $500.",
  }), fb);
  const result = await router.route("Hola", context, [], [], emptyState());
  assert.equal(fb.calls, 1);
  assert.doesNotMatch(result.message, /101|500|disponible/i);
});

test("deterministic fallback greets and acknowledges politely instead of acting like a command parser", async () => {
  const router = new DeterministicModelRouter();
  const hello = await router.route("hola", context, [], [], emptyState());
  const thanks = await router.route("gracias", context, [], [], emptyState());
  assert.equal(hello.kind, "message");
  assert.match(hello.message, /bienvenido|ayudar/i);
  assert.equal(thanks.kind, "message");
  assert.match(thanks.message, /seguimos|estadía|reserva/i);
});

test("multi-room planner must ground room labels in statePatch and cannot author bundle roomIds", async () => {
  const bundleTools = [{
    id: "hms.createReservationBundle",
    primitive: "RESERVE",
    description: "bundle",
    risk: "write",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { roomIds: { type: "array" }, checkIn: {}, checkOut: {}, allocations: { type: "array" } },
      required: ["roomIds", "checkIn", "checkOut"],
    },
  }];
  const state = {
    stay: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 5 },
    availabilityRoomIds: ["room-a", "room-b"],
    availabilityRooms: [{ id: "room-a", roomNumber: "101" }, { id: "room-b", roomNumber: "102" }],
    selectedRoomIds: [],
    roomGuestAllocations: {},
    activeBookingIds: [],
  };
  const fb = fallback();
  const router = new LLMModelRouter(provider({
    kind: "tool",
    toolId: "hms.createReservationBundle",
    input: {},
    clarificationReason: "none",
    missing: [],
    statePatch: { selectedRoomNumbers: ["102", "101"] },
    messageMode: "none",
    messageText: "",
  }), fb);
  const result = await router.route("Reservame la 102 y la 101 para las fechas que te dije", context, bundleTools, [], state);
  assert.equal(result.kind, "tool");
  assert.deepEqual(result.plan.input, {});
  assert.deepEqual(result.statePatch.selectedRoomNumbers, ["102", "101"]);
  assert.equal(fb.calls, 0);

  const unsafe = new LLMModelRouter(provider({
    kind: "tool",
    toolId: "hms.createReservationBundle",
    input: { roomIds: ["room-a", "room-b"] },
    clarificationReason: "none",
    missing: [],
    statePatch: {},
    messageMode: "none",
    messageText: "",
  }), fallback());
  const unsafeResult = await unsafe.route("Reservá las dos", context, bundleTools, [], state);
  assert.equal(unsafeResult.kind, "message");
  assert.equal(unsafeResult.message, "fallback");
});
