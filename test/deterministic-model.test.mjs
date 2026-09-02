import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";

const quoteTool = {
  id: "hms.getQuote",
  primitive: "QUOTE",
  description: "quote",
  risk: "read",
};

const roomId = "11000000-0000-0000-0000-000000000001";
const roomId102 = "11000000-0000-0000-0000-000000000002";
const roomId103 = "11000000-0000-0000-0000-000000000003";
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

test("R2.8.4 fallback resolves explicit room numbers only against authoritative availability before composite routing", async () => {
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

  assert.deepEqual(result, {
    kind: "tool",
    plan: {
      toolId: "hms.createMultiReservation",
      input: {
        roomIds: [roomId, roomId102],
        checkIn: "2030-01-01",
        checkOut: "2030-01-03",
      },
    },
    statePatch: { selectedRoomIds: [roomId, roomId102] },
  });
});

test("R2.8.4 late-review P2: deterministic fallback preserves every explicit room in a natural bounded list", async () => {
  const router = new DeterministicModelRouter();
  const state = {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 6 },
    availabilityRoomIds: [roomId, roomId102, roomId103],
    availabilityRooms: [
      { id: roomId, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
      { id: roomId103, roomNumber: "103" },
    ],
    selectedRoomIds: [],
  };

  const result = await router.route(
    "Quiero reservar las habitaciones 101, 102 y 103.",
    {},
    [reservationTool26, multiReservationTool],
    [],
    state,
  );

  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createMultiReservation");
  assert.deepEqual(result.plan.input.roomIds, [roomId, roomId102, roomId103]);
  assert.deepEqual(result.statePatch?.selectedRoomIds, [roomId, roomId102, roomId103]);
});

test("R2.8.4 late-review P1: staging gate requires exact approval-target correlation with C06 room ids", async () => {
  const source = await readFile(new URL("../scripts/r2.8-multi-room-dialogue.mjs", import.meta.url), "utf8");
  assert.match(source, /approvalTargetMatchesExpectedRooms/);
  assert.match(source, /expectedApprovalRoomIds/);
});

test("R2.8.4 fresh Codex P2: unsupported residual room separator cannot route a strict subset", async () => {
  const router = new DeterministicModelRouter();
  const state = {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 6 },
    availabilityRoomIds: [roomId, roomId102, roomId103],
    availabilityRooms: [
      { id: roomId, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
      { id: roomId103, roomNumber: "999" },
    ],
    selectedRoomIds: [],
  };

  const result = await router.route(
    "Quiero reservar las habitaciones 101, 102 o 999.",
    {},
    [reservationTool26, multiReservationTool],
    [],
    state,
  );

  assert.equal(result.kind, "message");
  assert.equal(result.purpose, "clarification");
  assert.deepEqual(result.missing, ["selection"]);
});

test("R2.8.4 fresh Codex P2: corpus tail bound covers the full four-request dialogue budget", async () => {
  const source = await readFile(new URL("../.github/workflows/r2.8-multi-room-dialogue.yml", import.meta.url), "utf8");
  const phaseB = source.slice(source.indexOf("# Phase B:"));
  const match = phaseB.match(/timeout\s+(\d+)s\s+script\s+-qefc/);
  assert.ok(match, "Phase B must keep a bounded wrangler tail");
  assert.ok(Number(match[1]) >= 130, `Phase B tail timeout too short: ${match[1]}s`);
});

test("R2.8.4 second fresh Codex P2: article-prefixed guest count is not parsed as another room", async () => {
  const router = new DeterministicModelRouter();
  const roomId4 = "11000000-0000-0000-0000-000000000004";
  const state = {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 4 },
    availabilityRoomIds: [roomId, roomId102, roomId4],
    availabilityRooms: [
      { id: roomId, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
      { id: roomId4, roomNumber: "4" },
    ],
    selectedRoomIds: [],
  };

  const result = await router.route(
    "Quiero reservar la 101 y la 102 para las 4 personas.",
    {},
    [reservationTool26, multiReservationTool],
    [],
    state,
  );

  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createMultiReservation");
  assert.deepEqual(result.plan.input.roomIds, [roomId, roomId102]);
  assert.deepEqual(result.statePatch?.selectedRoomIds, [roomId, roomId102]);
});

test("R2.8.4 third fresh Codex P2: room-count noun is not interpreted as room number 4", async () => {
  const router = new DeterministicModelRouter();
  const roomId4 = "11000000-0000-0000-0000-000000000004";
  const state = {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 8 },
    availabilityRoomIds: [roomId4, roomId, roomId102, roomId103],
    availabilityRooms: [
      { id: roomId4, roomNumber: "4" },
      { id: roomId, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
      { id: roomId103, roomNumber: "103" },
    ],
    selectedRoomIds: [],
  };

  const result = await router.route(
    "Quiero reservar las 4 habitaciones.",
    {},
    [reservationTool26, multiReservationTool],
    [],
    state,
  );

  assert.equal(result.kind, "message");
  assert.equal(result.purpose, "clarification");
  assert.deepEqual(result.missing, ["selection"]);
});

test("R2.8.4 third fresh Codex P2: Oxford-comma natural list cannot silently drop the final room", async () => {
  const router = new DeterministicModelRouter();
  const state = {
    stay: { checkIn: "2030-01-01", checkOut: "2030-01-03", guests: 6 },
    availabilityRoomIds: [roomId, roomId102, roomId103],
    availabilityRooms: [
      { id: roomId, roomNumber: "101" },
      { id: roomId102, roomNumber: "102" },
      { id: roomId103, roomNumber: "103" },
    ],
    selectedRoomIds: [],
  };

  const result = await router.route(
    "Quiero reservar las habitaciones 101, 102, y 103.",
    {},
    [reservationTool26, multiReservationTool],
    [],
    state,
  );

  assert.equal(result.kind, "tool");
  assert.equal(result.plan.toolId, "hms.createMultiReservation");
  assert.deepEqual(result.plan.input.roomIds, [roomId, roomId102, roomId103]);
  assert.deepEqual(result.statePatch?.selectedRoomIds, [roomId, roomId102, roomId103]);
});
