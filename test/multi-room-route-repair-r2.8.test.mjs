import test from "node:test";
import assert from "node:assert/strict";
import { LLMModelRouter } from "../dist/core/llm-model.js";

const context = {
  requestId: "r2.8.4-repair-request",
  tenant: {
    id: "tenant-r2.8.4",
    slug: "hotel-demo",
    status: "active",
    allowedToolIds: ["hms.createMultiReservation"],
  },
  actor: {
    id: "actor-r2.8.4",
    type: "customer",
    roles: ["customer"],
    permissions: ["hms.reservation.write"],
  },
  session: {
    id: "session-r2.8.4-repair",
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

function sequenceProvider() {
  return {
    requests: [],
    async completeStructured(request) {
      this.requests.push(request);
      if (this.requests.length === 1) {
        // Mirrors the exact R2.8.4 staging failure class: the model recognizes
        // the composite tool but contradicts itself by declaring already-known
        // room/date fields missing, so the candidate is not safe to execute.
        return {
          model: "fake",
          value: {
            kind: "tool",
            toolId: "hms.createMultiReservation",
            input: {},
            clarificationReason: "missing",
            missing: ["room", "dates"],
            statePatch: { selectedRoomNumbers: ["101", "102"] },
          },
        };
      }
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
    return { kind: "message", message: "deterministic fallback" };
  },
};

test("R2.8.4 contradictory multi-room tool shape gets one bounded model repair before deterministic fallback", async () => {
  const provider = sequenceProvider();
  fallback.calls = 0;
  const router = new LLMModelRouter(provider, fallback);

  const result = await router.route("Quiero reservar la 101 y la 102.", context, tools, [], state);

  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createMultiReservation");
  assert.deepEqual(result.statePatch.selectedRoomNumbers, ["101", "102"]);
  assert.equal(provider.requests.length, 2, "one repair inference should be attempted");
  assert.equal(provider.requests[0].label, "agent_core_route");
  assert.equal(provider.requests[1].label, "agent_core_route_repair");
  assert.match(provider.requests[1].messages[0].content, /repair one contradictory route candidate/i);
  assert.match(provider.requests[1].messages[0].content, /do not invent missing fields/i);
  assert.equal(fallback.calls, 0, "successful model repair must not depend on deterministic fallback");
});
