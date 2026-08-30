import test from "node:test";
import assert from "node:assert/strict";
import { createWebchatHandler } from "../dist/webchat/handler.js";
import { runtime } from "./helpers.mjs";

function post(handler, body, headers = {}) {
  return handler(new Request("https://core.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": "hotel-a", "x-actor-id": "visitor-1", ...headers },
    body: JSON.stringify(body),
  }));
}

test("webchat vertical slice returns structured availability", async () => {
  const r = runtime();
  const handler = createWebchatHandler(r);
  const response = await post(handler, { message: "¿Hay disponibilidad del 2026-09-10 al 2026-09-12 para 2 personas?" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.sessionId);
  assert.equal(body.data.truth, "transactional");
  assert.equal(body.data.rooms.some((room) => room.id === "room-101"), false);
  assert.equal(r.audit.events.some((event) => event.status === "succeeded"), true);
  assert.equal(r.usage.events.some((event) => event.kind === "tool_call"), true);
});

test("webchat vertical slice returns structured quote", async () => {
  const r = runtime();
  const handler = createWebchatHandler(r);
  const response = await post(handler, { message: "Cotizame room-102 del 2026-09-10 al 2026-09-12" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.sessionId);
  assert.equal(body.data.roomId, "room-102");
  assert.equal(body.data.nights, 2);
  assert.equal(body.data.nightlyRateCents, 82000);
  assert.equal(body.data.totalCents, 164000);
  assert.equal(body.data.currency, "ARS");
  assert.equal(r.audit.events.some((event) => event.toolId === "hms.getQuote" && event.status === "succeeded"), true);
});

test("quote intent cannot invent a room identifier", async () => {
  const r = runtime();
  const handler = createWebchatHandler(r);
  const response = await post(handler, { message: "¿Cuánto sale del 2026-09-10 al 2026-09-12?" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.message, /(?:de qué|qué) habitación/i);
  assert.doesNotMatch(body.message, /room-[a-z0-9_-]+|[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  assert.equal(r.audit.events.length, 0);
});

test("webchat session continues only within same tenant/actor", async () => {
  const r = runtime();
  const handler = createWebchatHandler(r);
  const first = await post(handler, { message: "disponibilidad 2026-09-01 2026-09-02 para 1 persona" });
  const a = await first.json();
  const second = await post(handler, { message: "disponibilidad 2026-09-02 2026-09-03 para 1 persona", sessionId: a.sessionId });
  assert.equal(second.status, 200);
  const switched = await post(handler, { message: "disponibilidad 2026-09-02 2026-09-03 para 1 persona", sessionId: a.sessionId }, { "x-tenant-id": "hotel-b" });
  assert.equal(switched.status, 403);
  assert.equal((await switched.json()).error.code, "TENANT_MISMATCH");
});
