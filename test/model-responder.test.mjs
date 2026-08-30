import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicGroundedResponder, LLMGroundedResponder } from "../dist/core/model-responder.js";

function provider(value, error) {
  return {
    async completeStructured() {
      if (error) throw error;
      return { value };
    },
  };
}

test("deterministic responder renders availability using only tool result", async () => {
  const responder = new DeterministicGroundedResponder();
  const message = await responder.compose({
    toolId: "hms.checkAvailability",
    data: { rooms: [{ roomNumber: "101", roomType: "DOBLE", priceCents: 25000 }] },
    conversation: [],
  });
  assert.match(message, /habitación 101/i);
  assert.match(message, /DOBLE/);
  assert.match(message, /\$250/);
});

test("LLM grounded responder accepts bounded structured message", async () => {
  const responder = new LLMGroundedResponder(provider({ message: "Tengo una habitación doble disponible a $250 por noche." }));
  const message = await responder.compose({
    toolId: "hms.checkAvailability",
    data: { rooms: [{ roomNumber: "101", roomType: "DOBLE", priceCents: 25000 }] },
    conversation: [],
  });
  assert.equal(message, "Tengo una habitación doble disponible a $250 por noche.");
});

test("malformed or failed response model falls back to deterministic grounded rendering", async () => {
  const malformed = new LLMGroundedResponder(provider({ nope: "invented" }));
  const failed = new LLMGroundedResponder(provider(undefined, new Error("down")));
  const input = { toolId: "hms.getQuote", data: { nights: 2, totalCents: 50000 }, conversation: [] };
  assert.match(await malformed.compose(input), /\$500/);
  assert.match(await failed.compose(input), /\$500/);
});
