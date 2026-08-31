import test from "node:test";
import assert from "node:assert/strict";
import {
  applyUserSemanticTurn,
  emptyConversationState,
  mergeConcurrentConversationState,
  updateConversationStateFromTool,
} from "../dist/core/conversation-state.js";

const scope = { tenantId: "hotel-r23-round4", actorId: "actor-r23-round4", sessionId: "session-r23-round4" };

test("booking conflict promotes operational revision even when semantic revisions differ", () => {
  const base = applyUserSemanticTurn(
    emptyConversationState(),
    "Somos dos del 15 al 17 de enero de 2027",
    scope,
  );
  const bookingA = updateConversationStateFromTool(
    base,
    "hms.createReservation",
    { roomId: "room-a", checkIn: "2027-01-15", checkOut: "2027-01-17" },
    { bookingId: "booking-a", status: "CONFIRMED" },
  );
  const bookingB0 = updateConversationStateFromTool(
    base,
    "hms.createReservation",
    { roomId: "room-b", checkIn: "2027-01-15", checkOut: "2027-01-17" },
    { bookingId: "booking-b", status: "CONFIRMED" },
  );
  const bookingB = applyUserSemanticTurn(bookingB0, "Prefiero una habitación tranquila", scope);

  assert.equal(bookingA.bookingStateRevision, bookingB.bookingStateRevision);
  assert.ok(bookingB.semanticMemory.revision > bookingA.semanticMemory.revision);

  const merged = mergeConcurrentConversationState(bookingA, bookingB);
  assert.equal(merged.activeBookingId, "booking-b");
  assert.ok((merged.bookingStateRevision ?? -1) > (bookingB.bookingStateRevision ?? -1));

  const staleA1 = applyUserSemanticTurn(bookingA, "Prefiero una habitación silenciosa", scope);
  const staleA2 = applyUserSemanticTurn(staleA1, "Prefiero piso alto", scope);
  assert.ok(staleA2.semanticMemory.revision > merged.semanticMemory.revision);

  const replayed = mergeConcurrentConversationState(merged, staleA2);
  assert.equal(replayed.activeBookingId, "booking-b");
  assert.equal(replayed.bookingStatus, "CONFIRMED");
  assert.equal(replayed.bookingStateRevision, merged.bookingStateRevision);
});

test("positive clear for another object cannot capture a later preserved date reference", () => {
  const preferred = applyUserSemanticTurn(
    emptyConversationState(),
    "Prefiero una habitación tranquila",
    scope,
  );
  const initial = applyUserSemanticTurn(preferred, "Del 15 al 17 de enero de 2027", scope);
  const updated = applyUserSemanticTurn(
    initial,
    "No borres las fechas; limpia mis preferencias y usa las fechas que ya te dije",
    scope,
  );

  assert.equal(updated.stay.checkIn, "2027-01-15");
  assert.equal(updated.stay.checkOut, "2027-01-17");
  assert.equal(updated.semanticMemory.preferences.length, 0);
  assert.ok(updated.semanticMemory.preferencesClearedAtRevision !== undefined);
});

test("positive preference clear cannot capture a later preserved guest reference", () => {
  const preferred = applyUserSemanticTurn(
    emptyConversationState(),
    "Prefiero una habitación tranquila",
    scope,
  );
  const initial = applyUserSemanticTurn(preferred, "Somos cuatro", scope);
  const updated = applyUserSemanticTurn(
    initial,
    "No borres la cantidad de personas; limpia mis preferencias y usa la cantidad que ya te dije",
    scope,
  );

  assert.equal(updated.stay.guests, 4);
  assert.equal(updated.semanticMemory.preferences.length, 0);
});
