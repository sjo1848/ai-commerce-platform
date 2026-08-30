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

test("2.6 fallback reservation does not require or emit a guest UUID when identity is server-bound", async () => {
  const router = new DeterministicModelRouter();
  const result = await router.route(
    `reservar habitación ${roomId} del 2034-02-10 al 2034-02-12`,
    {},
    [reservationTool26],
  );
  assert.deepEqual(result, {
    kind: "tool",
    plan: {
      toolId: "hms.createReservation",
      input: { roomId, checkIn: "2034-02-10", checkOut: "2034-02-12" },
    },
  });
  assert.equal(Object.hasOwn(result.plan.input, "guestId"), false);
});

test("legacy schema-less reservation fallback still requires explicit guest identity", async () => {
  const router = new DeterministicModelRouter();
  const legacy = { id: "hms.createReservation", primitive: "RESERVE", description: "legacy reserve", risk: "write" };
  const missing = await router.route(`reservar habitación ${roomId} del 2034-02-10 al 2034-02-12`, {}, [legacy]);
  assert.equal(missing.kind, "message");
  assert.match(missing.message, /huésped/i);

  const explicit = await router.route(
    `reservar habitación ${roomId} huésped ${guestId} del 2034-02-10 al 2034-02-12`,
    {},
    [legacy],
  );
  assert.equal(explicit.kind, "tool");
  assert.equal(explicit.plan.input.guestId, guestId);
});
