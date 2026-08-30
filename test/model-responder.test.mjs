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

test("LLM grounded responder can choose bounded CTA but cannot author operational facts", async () => {
  const responder = new LLMGroundedResponder(provider({ style: "warm", nextStep: "quote" }));
  const message = await responder.compose({
    toolId: "hms.checkAvailability",
    data: { rooms: [{ roomNumber: "101", roomType: "DOBLE", priceCents: 25000 }] },
    conversation: [],
  });
  assert.match(message, /habitación 101/i);
  assert.match(message, /DOBLE/);
  assert.match(message, /\$250/);
  assert.match(message, /cotizo/i);
});

test("malformed, unsafe or failed response model falls back to deterministic grounded rendering", async () => {
  const malformed = new LLMGroundedResponder(provider({ nope: "invented" }));
  const unsafe = new LLMGroundedResponder(provider({ style: "warm", nextStep: "reserve", message: "desayuno gratis" }));
  const failed = new LLMGroundedResponder(provider(undefined, new Error("down")));
  const input = { toolId: "hms.getQuote", data: { nights: 2, totalCents: 50000 }, conversation: [] };
  assert.match(await malformed.compose(input), /\$500/);
  assert.match(await unsafe.compose(input), /\$500/);
  assert.doesNotMatch(await unsafe.compose(input), /desayuno/i);
  assert.match(await failed.compose(input), /\$500/);
});
