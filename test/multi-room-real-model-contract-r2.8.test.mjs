import test from "node:test";
import assert from "node:assert/strict";
import { LLMModelRouter } from "../dist/core/llm-model.js";

const context = {
  requestId: "r2.8.4-request",
  tenant: {
    id: "tenant-r2.8.4",
    slug: "hotel-demo",
    status: "active",
    allowedToolIds: ["hms.createReservation", "hms.createMultiReservation"],
  },
  actor: {
    id: "actor-r2.8.4",
    type: "customer",
    roles: ["customer"],
    permissions: ["hms.reservation.write"],
  },
  session: {
    id: "session-r2.8.4",
    tenantId: "tenant-r2.8.4",
    actorId: "actor-r2.8.4",
    channel: "webchat",
    createdAt: "2026-09-01T12:00:00.000Z",
    expiresAt: "2026-09-02T12:00:00.000Z",
  },
  now: "2026-09-01T12:00:00.000Z",
};

const tools = [
  {
    id: "hms.createReservation",
    primitive: "RESERVE",
    description: "Reserva una habitación grounded.",
    risk: "write",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        roomId: { type: "string" },
        checkIn: { type: "string" },
        checkOut: { type: "string" },
      },
      required: ["roomId", "checkIn", "checkOut"],
    },
  },
  {
    id: "hms.createMultiReservation",
    primitive: "RESERVE",
    description: "Reserva varias habitaciones como una operación compuesta grounded por Core.",
    risk: "write",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { notes: { type: ["string", "null"] } },
    },
  },
];

function provider() {
  return {
    request: undefined,
    async completeStructured(request) {
      this.request = request;
      return {
        model: "fake",
        value: {
          kind: "tool",
          toolId: "hms.createMultiReservation",
          input: {},
          clarificationReason: "none",
          missing: [],
          statePatch: { selectedRoomNumbers: ["101", "102"] },
        },
      };
    },
  };
}

const fallback = {
  calls: 0,
  async route() {
    this.calls += 1;
    return { kind: "message", message: "fallback" };
  },
};

test("R2.8.4 router prompt advertises current composite multi-room capability and removes stale R2.4 blocking text", async () => {
  const p = provider();
  const router = new LLMModelRouter(p, fallback);
  const state = {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 4 },
    availabilityRoomIds: ["room-101", "room-102", "room-103"],
    availabilityRooms: [
      { id: "room-101", roomNumber: "101" },
      { id: "room-102", roomNumber: "102" },
      { id: "room-103", roomNumber: "103" },
    ],
    selectedRoomIds: [],
    roomOccupancy: [],
  };

  const result = await router.route("Quiero reservar la 101 y la 102.", context, tools, [], state);
  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createMultiReservation");
  assert.equal(fallback.calls, 0);

  const prompt = p.request.messages.map((item) => item.content).join("\n");
  assert.match(prompt, /hms\.createMultiReservation:\s*multi-room reservation intent/i);
  assert.match(prompt, /Quiero reservar la 101 y la 102/i);
  assert.match(prompt, /reserv[aá] esas dos/i);
  assert.doesNotMatch(prompt, /Core blocks multi-room side effects until R2\.5/i);
  assert.doesNotMatch(prompt, /More than one selected room is conversation state only in R2\.4/i);
});
