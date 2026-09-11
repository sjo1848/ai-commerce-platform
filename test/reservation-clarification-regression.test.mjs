import test from "node:test";
import assert from "node:assert/strict";
import { LLMModelRouter } from "../dist/core/llm-model.js";

const context = {
  requestId: "r-reserve",
  tenant: { id: "hotel-demo", slug: "hotel-demo", status: "active", allowedToolIds: ["hms.createReservation"] },
  actor: { id: "visitor", type: "customer", roles: ["customer"], permissions: [] },
  session: { id: "s-reserve", tenantId: "hotel-demo", actorId: "visitor", channel: "webchat", createdAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z" },
  now: "2026-08-30T15:00:00.000Z",
};

const roomId = "11000000-0000-0000-0000-000000000001";
const tools = [{
  id: "hms.createReservation",
  primitive: "RESERVE",
  risk: "write",
  description: "Create reservation with server-bound guest identity.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { roomId: { type: "string" }, checkIn: { type: "string" }, checkOut: { type: "string" } },
    required: ["roomId", "checkIn", "checkOut"],
  },
}];

test("model cannot make guests a reservation prerequisite when the visible schema does not require it", async () => {
  const provider = {
    async completeStructured() {
      return {
        value: { kind: "message", toolId: "", input: {}, clarificationReason: "missing", missing: ["guests"] },
        model: "fake",
      };
    },
  };
  const fallback = {
    calls: 0,
    async route() {
      this.calls += 1;
      return {
        kind: "tool",
        plan: {
          toolId: "hms.createReservation",
          input: { roomId, checkIn: "2032-01-10", checkOut: "2032-01-12" },
        },
      };
    },
  };
  const router = new LLMModelRouter(provider, fallback);
  const result = await router.route(
    `reservar habitación ${roomId} del 2032-01-10 al 2032-01-12`,
    context,
    tools,
  );

  assert.equal(fallback.calls, 1);
  assert.equal(result.kind, "message");
  assert.equal(Object.hasOwn(result, "plan"), false);
  assert.equal(Object.hasOwn(result, "statePatch"), false);
});
