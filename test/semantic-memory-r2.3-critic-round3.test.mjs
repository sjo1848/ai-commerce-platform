import test from "node:test";
import assert from "node:assert/strict";
import { applyUserSemanticTurn, emptyConversationState } from "../dist/core/conversation-state.js";

const scope = { tenantId: "hotel-r23-round3", actorId: "actor-r23-round3", sessionId: "session-r23-round3" };

test("partial category correction replaces the corrected category without losing unaffected adults", () => {
  const state = applyUserSemanticTurn(
    emptyConversationState(),
    "Somos 2 adultos y 2 niños; no, 1 niño",
    scope,
  );
  assert.equal(state.stay.guests, 3);
});

test("category correction replaces an earlier aggregate of child aliases", () => {
  const state = applyUserSemanticTurn(
    emptyConversationState(),
    "Somos 2 adultos, 1 niño y 1 niña; no, 1 niño",
    scope,
  );
  assert.equal(state.stay.guests, 3);
});

test("coordinated negated clear verbs do not erase remembered dates", () => {
  const initial = applyUserSemanticTurn(
    emptyConversationState(),
    "Somos cuatro del 15 al 17 de enero de 2027",
    scope,
  );
  const updated = applyUserSemanticTurn(initial, "No borres ni olvides las fechas", scope);
  assert.equal(updated.stay.checkIn, "2027-01-15");
  assert.equal(updated.stay.checkOut, "2027-01-17");
});

test("coordinated negation propagates across a chain of clear verbs", () => {
  const initial = applyUserSemanticTurn(
    emptyConversationState(),
    "Somos cuatro del 15 al 17 de enero de 2027",
    scope,
  );
  const updated = applyUserSemanticTurn(initial, "No borres ni limpies ni olvides las fechas", scope);
  assert.equal(updated.stay.checkIn, "2027-01-15");
  assert.equal(updated.stay.checkOut, "2027-01-17");
});

test("reserva followed by a purpose clause remains a valid lodging noun", () => {
  const state = applyUserSemanticTurn(
    emptyConversationState(),
    "Prefiero una habitación con vista a la reserva para observar aves",
    scope,
  );
  assert.equal(state.semanticMemory.preferences.length, 1);
  assert.match(state.semanticMemory.preferences[0].value, /reserva para observar aves/i);
});

test("contextual reservation imperative is still rejected from durable preferences", () => {
  const initial = applyUserSemanticTurn(emptyConversationState(), "Prefiero una habitación tranquila", scope);
  const poisoned = applyUserSemanticTurn(
    initial,
    "Prefiero una habitación tranquila y reserva para mañana",
    scope,
  );
  assert.deepEqual(poisoned.semanticMemory.preferences, initial.semanticMemory.preferences);
});
