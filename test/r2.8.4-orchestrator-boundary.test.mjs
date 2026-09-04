import test from "node:test";
import assert from "node:assert/strict";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { ApprovalRequiredError } from "../dist/core/errors.js";
import { emptyConversationState } from "../dist/core/conversation-state.js";
import { RESERVATION_GROUP_STATE_TOOL_ID } from "../dist/core/reservation-group-state.js";

const actor = { id: "visitor-1", type: "customer", roles: ["customer"], permissions: ["hms.availability.read", "hms.reservation.write", "hms.cancellation.write"] };
const baseTools = [
  { id: "hms.checkAvailability", primitive: "CHECK", description: "availability", risk: "read", sideEffect: "none", requiredPermissions: ["hms.availability.read"], inputSchema: { type: "object", additionalProperties: false, properties: { checkIn: { type: "string" }, checkOut: { type: "string" }, guests: { type: "integer" } }, required: ["checkIn", "checkOut", "guests"] }, validateInput: (input) => ({ ok: true, value: input }), execute: async (input) => ({ rooms: [{ id: "room-a", roomNumber: "101" }], input }) },
  { id: "hms.createReservation", primitive: "RESERVE", description: "reserve", risk: "write", sideEffect: "reversible", requiredPermissions: ["hms.reservation.write"], inputSchema: { type: "object", additionalProperties: false, properties: { roomId: { type: "string" }, checkIn: { type: "string" }, checkOut: { type: "string" } }, required: ["roomId", "checkIn", "checkOut"] }, validateInput: (input) => ({ ok: true, value: input }), execute: async () => ({ bookingId: "booking-new" }) },
  { id: "hms.cancelReservation", primitive: "CANCEL", description: "cancel", risk: "write", sideEffect: "reversible", requiredPermissions: ["hms.cancellation.write"], inputSchema: { type: "object", additionalProperties: false, properties: { bookingId: { type: "string" } }, required: ["bookingId"] }, validateInput: (input) => ({ ok: true, value: input }), execute: async (input) => ({ bookingId: input.bookingId }) },
  { id: "hms.cancelMultiReservation", primitive: "CANCEL", description: "cancel group", risk: "write", sideEffect: "reversible", requiredPermissions: ["hms.cancellation.write"], inputSchema: { type: "object", additionalProperties: false, properties: { bookingIds: { type: "array" } }, required: ["bookingIds"] }, validateInput: (input) => ({ ok: true, value: input }), execute: async (input) => ({ bookingIds: input.bookingIds }) },
];

function responder() { return { async compose(input) { return input.baseMessage ?? "ok"; } }; }
async function setup(route, allowedToolIds = baseTools.map((tool) => tool.id), toolPolicies = {}) {
  const runtime = new AgentCoreRuntime({
    tools: baseTools,
    tenants: [{ id: "hotel-a", slug: "hotel-a", status: "active", allowedToolIds, toolPolicies }],
    responder: responder(),
    now: () => new Date("2026-08-29T13:00:00.000Z"),
    model: { async route() { return route; } },
  });
  const context = await runtime.createContext({ tenantId: "hotel-a", actor, channel: "webchat" });
  return { runtime, context };
}
function stateWithRooms() {
  const state = emptyConversationState();
  state.availabilityRoomIds = ["room-a"];
  state.availabilityRooms = [{ id: "room-a", roomNumber: "101" }];
  return state;
}

test("read route without mutation grounding enriches mechanical dates and guests post-route", async () => {
  const { runtime, context } = await setup({ kind: "tool", plan: { toolId: "hms.checkAvailability", input: {} }, statePatch: {}, mutationGrounding: undefined }, ["hms.checkAvailability"]);
  await runtime.orchestrator.chat("Somos dos del 15 al 17 de enero de 2027", context);
  const state = await runtime.conversationState.get(context.session.id);
  assert.deepEqual(state.stay, { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 });
});

test("write route without grounding clarifies and leaves state and executor untouched", async () => {
  const { runtime, context } = await setup({ kind: "tool", plan: { toolId: "hms.createReservation", input: {} }, statePatch: {} }, ["hms.createReservation"]);
  const before = await runtime.conversationState.get(context.session.id);
  const result = await runtime.orchestrator.chat("reservá", context);
  assert.equal(result.outcome, "clarification");
  assert.deepEqual(await runtime.conversationState.get(context.session.id), before);
  assert.equal(runtime.audit.events.some((event) => event.status === "succeeded"), false);
});

test("unknown room and tool/kind mismatch fail closed without execution or state mutation", async () => {
  for (const route of [
    { kind: "tool", plan: { toolId: "hms.createReservation", input: {} }, statePatch: {}, mutationGrounding: { kind: "reservation", checkIn: "2027-01-15", checkOut: "2027-01-17", roomIds: ["room-forged"] } },
    { kind: "tool", plan: { toolId: "hms.createReservation", input: {} }, statePatch: {}, mutationGrounding: { kind: "cancellation", scope: "all" } },
  ]) {
    const { runtime, context } = await setup(route, ["hms.createReservation"]);
    await runtime.conversationState.put(context.session.id, stateWithRooms());
    const before = await runtime.conversationState.get(context.session.id);
    const result = await runtime.orchestrator.chat("hacelo", context);
    assert.equal(result.outcome, "clarification");
    assert.deepEqual(await runtime.conversationState.get(context.session.id), before);
    assert.equal(runtime.audit.events.some((event) => event.status === "succeeded"), false);
  }
});

test("valid reservation grounding canonicalizes state before approval", async () => {
  const route = { kind: "tool", plan: { toolId: "hms.createReservation", input: { roomId: "forged", checkIn: "1900-01-01", checkOut: "1900-01-02" } }, statePatch: {}, mutationGrounding: { kind: "reservation", checkIn: "2027-01-15", checkOut: "2027-01-17", roomIds: ["room-a"] } };
  const { runtime, context } = await setup(route, ["hms.createReservation"], { "hms.createReservation": "approval" });
  const seeded = stateWithRooms();
  seeded.stay = { checkIn: "2027-01-15", checkOut: "2027-01-17" };
  await runtime.conversationState.put(context.session.id, seeded);
  await assert.rejects(() => runtime.orchestrator.chat("reservá la 101", context), ApprovalRequiredError);
  const state = await runtime.conversationState.get(context.session.id);
  assert.equal(state.stay.checkIn, "2027-01-15");
  assert.equal(state.stay.checkOut, "2027-01-17");
  assert.deepEqual(state.selectedRoomIds, ["room-a"]);
});

test("route clarification is observable as outcome and missing fields", async () => {
  const { runtime, context } = await setup({ kind: "message", message: "Elegí las fechas", purpose: "clarification", missing: ["dates"], statePatch: {} }, ["hms.checkAvailability"]);
  const result = await runtime.orchestrator.chat("¿hay lugar?", context);
  assert.deepEqual({ outcome: result.outcome, missing: result.missing }, { outcome: "clarification", missing: ["dates"] });
});

test("cancellation scope and booking are structured; contradictory wording cannot override grounding", async () => {
  const route = { kind: "tool", plan: { toolId: "hms.cancelReservation", input: {} }, statePatch: {}, mutationGrounding: { kind: "cancellation", scope: "single", bookingId: "booking-1" } };
  const { runtime, context } = await setup(route, ["hms.cancelReservation"], { "hms.cancelReservation": "approval" });
  await runtime.conversation.append(context.session.id, { role: "tool", toolId: RESERVATION_GROUP_STATE_TOOL_ID, content: JSON.stringify({ activeBookingIds: ["booking-1", "booking-2"], activeBookings: [{ bookingId: "booking-1", roomNumber: "101" }, { bookingId: "booking-2", roomNumber: "102" }], revision: 1 }) });
  await assert.rejects(() => runtime.orchestrator.chat("cancelá todo, especialmente booking-2", context), ApprovalRequiredError);
  const approval = runtime.audit.events.find((event) => event.status === "approval_required");
  assert.equal(approval?.toolId, "hms.cancelReservation");
});

test("all cancellation with one active booking canonicalizes multi route to exact single plan", async () => {
  const route = { kind: "tool", plan: { toolId: "hms.cancelMultiReservation", input: { bookingIds: ["forged"] } }, statePatch: {}, mutationGrounding: { kind: "cancellation", scope: "all" } };
  const { runtime, context } = await setup(route, ["hms.cancelReservation", "hms.cancelMultiReservation"], { "hms.cancelReservation": "approval", "hms.cancelMultiReservation": "approval" });
  await runtime.conversation.append(context.session.id, { role: "tool", toolId: RESERVATION_GROUP_STATE_TOOL_ID, content: JSON.stringify({ activeBookingIds: ["booking-only"], activeBookings: [{ bookingId: "booking-only" }], revision: 1 }) });
  await assert.rejects(() => runtime.orchestrator.chat("cancelá todo", context), ApprovalRequiredError);
  const approval = runtime.audit.events.find((event) => event.status === "approval_required");
  assert.equal(approval?.toolId, "hms.cancelReservation");
});

test("all cancellation with one active booking clarifies when single tool is hidden", async () => {
  const route = { kind: "tool", plan: { toolId: "hms.cancelMultiReservation", input: {} }, statePatch: {}, mutationGrounding: { kind: "cancellation", scope: "all" } };
  const { runtime, context } = await setup(route, ["hms.cancelMultiReservation"]);
  await runtime.conversation.append(context.session.id, { role: "tool", toolId: RESERVATION_GROUP_STATE_TOOL_ID, content: JSON.stringify({ activeBookingIds: ["booking-only"], activeBookings: [{ bookingId: "booking-only" }], revision: 1 }) });
  const result = await runtime.orchestrator.chat("cancelá todo", context);
  assert.equal(result.outcome, "clarification");
  assert.deepEqual(result.missing, ["booking"]);
});

test("activeBookings routing context is not persisted in conversation state", async () => {
  let routedState;
  const model = { async route(_message, _context, _tools, _conversation, state) { routedState = state; return { kind: "message", message: "ok", purpose: "acknowledgement", statePatch: {} }; } };
  const runtime = new AgentCoreRuntime({ tenants: [{ id: "hotel-a", slug: "hotel-a", status: "active", allowedToolIds: ["hms.checkAvailability"] }], tools: baseTools, model, responder: responder(), now: () => new Date("2026-08-29T13:00:00.000Z") });
  const context = await runtime.createContext({ tenantId: "hotel-a", actor, channel: "webchat" });
  await runtime.conversation.append(context.session.id, { role: "tool", toolId: RESERVATION_GROUP_STATE_TOOL_ID, content: JSON.stringify({ activeBookingIds: ["booking-1"], activeBookings: [{ bookingId: "booking-1" }], revision: 1 }) });
  await runtime.orchestrator.chat("ok", context);
  assert.equal("activeBookings" in (await runtime.conversationState.get(context.session.id)), false);
  assert.deepEqual(routedState?.activeBookings, [{ bookingId: "booking-1" }]);
});
