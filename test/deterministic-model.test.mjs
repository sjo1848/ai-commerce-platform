import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";

const quoteTool = {
  id: "hms.getQuote",
  primitive: "QUOTE",
  description: "quote",
  risk: "read",
};

const roomId = "11000000-0000-0000-0000-000000000001";
const roomId102 = "11000000-0000-0000-0000-000000000002";
const guestId = "12000000-0000-0000-0000-000000000001";

const availabilityTool26 = {
  id: "hms.checkAvailability",
  primitive: "CHECK",
  description: "availability",
  risk: "read",
  inputSchema: {
    type: "object",
    properties: { checkIn: { type: "string" }, checkOut: { type: "string" }, guests: { type: "integer" } },
    required: ["checkIn", "checkOut", "guests"],
  },
};

const reservationTool26 = {
  id: "hms.createReservation",
  primitive: "RESERVE",
  description: "reserve with server-bound guest identity",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: { roomId: { type: "string" }, checkIn: { type: "string" }, checkOut: { type: "string" } },
    required: ["roomId", "checkIn", "checkOut"],
  },
};

const multiReservationTool = {
  id: "hms.createMultiReservation",
  primitive: "RESERVE",
  description: "reserve multiple grounded rooms",
  risk: "write",
};

test("router accepts HMS UUID-shaped room ids without RFC version bits", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    `cotizame ${roomId} del 2027-01-15 al 2027-01-17`,
    {},
    [quoteTool],
  );

  assert.deepEqual(result, {
    kind: "tool",
    plan: {
      toolId: "hms.getQuote",
      input: {
        roomId,
        checkIn: "2027-01-15",
        checkOut: "2027-01-17",
      },
    },
  });
});

test("router fails closed when quote capability is not visible", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "precio room-102 del 2027-01-15 al 2027-01-17",
    {},
    [],
  );

  assert.equal(result.kind, "message");
  assert.match(result.message, /no está habilitada/i);
});

test("2.6 fallback clarifies missing guest count instead of guessing one", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    "¿Qué hay disponible del 2034-02-10 al 2034-02-12?",
    {},
    [availabilityTool26],
  );
  assert.equal(result.kind, "message");
  assert.match(result.message, /cuántas personas/i);
});

test("R2.8.4 deterministic fallback never prepares a natural-language reservation write", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    `reservar habitación ${roomId} del 2034-02-10 al 2034-02-12`,
    {},
    [reservationTool26],
  );
  assert.equal(result.kind, "message");
  assert.equal(Object.hasOwn(result, "plan"), false);
  assert.equal(Object.hasOwn(result, "statePatch"), false);
});

test("legacy schema-less reservation fallback still requires explicit guest identity", async () => {
  const router = new DeterministicModelRouter();
  const legacy = { id: "hms.createReservation", primitive: "RESERVE", description: "legacy reserve", risk: "write" };
  const missing = await router.route(`reservar habitación ${roomId} del 2034-02-10 al 2034-02-12`, {}, [legacy]);
  assert.equal(missing.kind, "message");
  assert.equal(Object.hasOwn(missing, "plan"), false);
  assert.equal(Object.hasOwn(missing, "statePatch"), false);

  const explicit = await router.route(
    `reservar habitación ${roomId} huésped ${guestId} del 2034-02-10 al 2034-02-12`,
    {},
    [legacy],
  );
  assert.equal(explicit.kind, "message");
  assert.equal(Object.hasOwn(explicit, "plan"), false);
  assert.equal(Object.hasOwn(explicit, "statePatch"), false);
});

test("R2.8.4 deterministic fallback does not derive room selection from natural language", async () => {
  const router = new DeterministicModelRouter();
  const state = {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 4 },
    availabilityRoomIds: [roomId, roomId102],
    availabilityRooms: [
      { id: roomId, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
    ],
    selectedRoomIds: [],
  };

  const result = await router.route(
    "Quiero reservar la 101 y la 102.",
    {},
    [reservationTool26, multiReservationTool],
    [],
    state,
  );

  assert.equal(result.kind, "message");
  assert.equal(Object.hasOwn(result, "plan"), false);
  assert.equal(Object.hasOwn(result, "statePatch"), false);
});
