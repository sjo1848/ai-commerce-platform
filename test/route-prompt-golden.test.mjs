import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { LLMModelRouter } from "../dist/core/llm-model.js";

test("route prompt assembly remains byte-for-byte stable for the golden fixture", async () => {
  let system = "";
  const provider = {
    async completeStructured(request) {
      system = request.messages[0].content;
      return { value: { kind: "message", toolId: "", input: {}, clarificationReason: "acknowledgement", missing: [], statePatch: {}, mutationGrounding: null } };
    },
  };
  const router = new LLMModelRouter(provider, { async route() { return { kind: "message", message: "fallback" }; } });
  await router.route("Somos dos, ¿qué hay?", {
    now: "2026-08-30T14:00:00.000Z", tenant: { id: "hotel-demo" }, session: { id: "golden-session" },
  }, [{ id: "hms.checkAvailability", description: "availability", risk: "read", inputSchema: { type: "object", properties: {}, required: [] } }], [], {
    stay: { guests: 2 }, availabilityRoomIds: [], availabilityRooms: [], selectedRoomIds: [], roomOccupancy: [],
  });
  assert.equal(Buffer.byteLength(system), 10981);
  assert.equal(createHash("sha256").update(system).digest("hex"), "4989b5d3a4aff1992bdd1f43f4ca699c9df3f33da973afed2ae24147aa41961c");
});
