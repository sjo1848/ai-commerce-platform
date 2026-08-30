import test from "node:test";
import assert from "node:assert/strict";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { InMemorySessionStore } from "../dist/core/session.js";
import { createWebchatHandler } from "../dist/webchat/handler.js";
import { tenantA, tenantB } from "./helpers.mjs";

function post(handler, body, tenantId = "hotel-a") {
  return handler(new Request("https://core.test/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": tenantId,
      "x-actor-id": "visitor-1",
    },
    body: JSON.stringify(body),
  }));
}

function isolatedRuntime(sharedStore) {
  return new AgentCoreRuntime({
    tenants: [tenantA, tenantB],
    sessionStore: sharedStore,
    now: () => new Date("2026-08-29T13:00:00.000Z"),
  });
}

test("shared persistent session store survives runtime/isolate replacement", async () => {
  const sharedStore = new InMemorySessionStore();
  const firstHandler = createWebchatHandler(isolatedRuntime(sharedStore));
  const first = await post(firstHandler, {
    message: "disponibilidad 2026-09-10 2026-09-12 para 1 persona",
  });
  assert.equal(first.status, 200);
  const availability = await first.json();
  assert.ok(availability.sessionId);

  // New runtime instance simulates a subsequent request landing on another Worker isolate.
  const secondHandler = createWebchatHandler(isolatedRuntime(sharedStore));
  const second = await post(secondHandler, {
    message: "cotizame room-102 del 2026-09-10 al 2026-09-12",
    sessionId: availability.sessionId,
  });
  assert.equal(second.status, 200);
  const quote = await second.json();
  assert.equal(quote.sessionId, availability.sessionId);
  assert.equal(quote.data.roomId, "room-102");
  assert.equal(quote.data.totalCents, 164000);
});

test("persistent session still rejects tenant replay after runtime replacement", async () => {
  const sharedStore = new InMemorySessionStore();
  const firstHandler = createWebchatHandler(isolatedRuntime(sharedStore));
  const first = await post(firstHandler, {
    message: "disponibilidad 2026-09-10 2026-09-12 para 1 persona",
  });
  const availability = await first.json();

  const secondHandler = createWebchatHandler(isolatedRuntime(sharedStore));
  const replay = await post(secondHandler, {
    message: "disponibilidad 2026-09-11 2026-09-12 para 1 persona",
    sessionId: availability.sessionId,
  }, "hotel-b");

  assert.equal(replay.status, 403);
  assert.equal((await replay.json()).error.code, "TENANT_MISMATCH");
});
