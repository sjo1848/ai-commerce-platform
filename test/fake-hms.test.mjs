import test from "node:test";
import assert from "node:assert/strict";
import { runtime, actor } from "./helpers.mjs";

test("fake HMS availability excludes occupied room nights", async () => {
  const r = runtime();
  const ctx = await r.createContext({ tenantId: "hotel-a", actor, channel: "webchat" });
  const result = await r.executor.execute("hms.checkAvailability", { checkIn: "2026-09-10", checkOut: "2026-09-12", guests: 2 }, ctx);
  assert.equal(result.truth, "transactional");
  assert.equal(result.rooms.some((room) => room.id === "room-101"), false);
  assert.equal(result.rooms.some((room) => room.id === "room-102"), true);
});

test("fake HMS quote uses integer cents and night count", async () => {
  const r = runtime();
  const ctx = await r.createContext({ tenantId: "hotel-a", actor, channel: "webchat" });
  const result = await r.executor.execute("hms.getQuote", { roomId: "room-201", checkIn: "2026-09-10", checkOut: "2026-09-13" }, ctx);
  assert.equal(result.nights, 3);
  assert.equal(result.totalCents, 360000);
  assert.equal(Number.isInteger(result.totalCents), true);
});

test("fake HMS rejects impossible calendar dates instead of Date normalization", async () => {
  const r = runtime();
  const ctx = await r.createContext({ tenantId: "hotel-a", actor, channel: "webchat" });
  await assert.rejects(
    () => r.executor.execute("hms.checkAvailability", { checkIn: "2026-02-31", checkOut: "2026-03-04", guests: 1 }, ctx),
    (e) => e.code === "BAD_REQUEST",
  );
});
