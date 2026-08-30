import test from "node:test";
import assert from "node:assert/strict";
import { ChatOrchestrator } from "../dist/core/orchestrator.js";
import { InMemoryConversationStore } from "../dist/core/conversation.js";
import { InMemoryConversationStateStore } from "../dist/core/conversation-state.js";

const context = {
  requestId: "request-cancel-ambiguous",
  tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: ["hms.cancelReservation"] },
  actor: { id: "visitor-demo", type: "customer", roles: ["customer"], permissions: ["hms.reservation.cancel"] },
  session: { id: "session-cancel-ambiguous", tenantId: "hotel-demo", actorId: "visitor-demo", channel: "webchat", createdAt: "2026-08-30T20:00:00-03:00", expiresAt: "2026-08-31T20:00:00-03:00" },
  now: "2026-08-30T20:00:00-03:00",
};

const cancelDescriptor = {
  id: "hms.cancelReservation",
  primitive: "CANCEL",
  description: "cancel",
  risk: "write",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { bookingId: { type: "string" } },
    required: ["bookingId"],
  },
};

test("generic cancellation with multiple active bookings asks which booking instead of cancelling the primary implicitly", async () => {
  const stateStore = new InMemoryConversationStateStore();
  await stateStore.put(context.session.id, {
    stay: { checkIn: "2034-02-10", checkOut: "2034-02-12", guests: 5 },
    availabilityRoomIds: [],
    availabilityRooms: [],
    selectedRoomIds: [],
    roomGuestAllocations: {},
    activeBookingId: "booking-a",
    activeBookingIds: ["booking-a", "booking-b"],
    bookingStatus: "CONFIRMED",
  });

  let executions = 0;
  const orchestrator = new ChatOrchestrator(
    { async route() { return { kind: "tool", plan: { toolId: "hms.cancelReservation", input: {} } }; } },
    { async compose() { return "should not execute"; } },
    { descriptorsFor() { return [cancelDescriptor]; } },
    { async execute() { executions += 1; throw new Error("must not execute"); } },
    { async record() {} },
    { async record() {} },
    new InMemoryConversationStore(),
    stateStore,
  );

  const result = await orchestrator.chat("Mejor cancelala", context);
  assert.equal(executions, 0);
  assert.match(result.message, /más de una reserva activa/i);
  assert.match(result.message, /cuál querés cancelar/i);
});

test("explicit booking id remains executable even when multiple bookings are active", async () => {
  const stateStore = new InMemoryConversationStateStore();
  await stateStore.put(context.session.id, {
    stay: {},
    availabilityRoomIds: [],
    availabilityRooms: [],
    selectedRoomIds: [],
    roomGuestAllocations: {},
    activeBookingId: "booking-a",
    activeBookingIds: ["booking-a", "booking-b"],
  });

  let executedInput;
  const orchestrator = new ChatOrchestrator(
    { async route() { return { kind: "tool", plan: { toolId: "hms.cancelReservation", input: { bookingId: "booking-b" } } }; } },
    { async compose() { return "Cancelada."; } },
    { descriptorsFor() { return [cancelDescriptor]; } },
    { async execute(_toolId, input) { executedInput = input; return { bookingId: input.bookingId, status: "CANCELLED" }; } },
    { async record() {} },
    { async record() {} },
    new InMemoryConversationStore(),
    stateStore,
  );

  const result = await orchestrator.chat("Cancelá la booking-b", context);
  assert.deepEqual(executedInput, { bookingId: "booking-b" });
  assert.equal(result.message, "Cancelada.");
});
