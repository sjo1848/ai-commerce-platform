import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";

const quoteTool = {
  id: "hms.getQuote",
  primitive: "QUOTE",
  description: "quote",
  risk: "read",
};

test("router accepts HMS UUID-shaped room ids without RFC version bits", async () => {
  const router = new DeterministicModelRouter();
  const roomId = "11000000-0000-0000-0000-000000000001";
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
