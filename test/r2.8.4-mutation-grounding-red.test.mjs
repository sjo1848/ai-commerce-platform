import test from "node:test";
import assert from "node:assert/strict";

// RED contract tests: this module/API is intentionally supplied by the rework implementation.
const { validateMutationGrounding, createClarificationResult } =
  await import("../dist/core/mutation-grounding.js");

const reservation = (extra = {}) => ({
  kind: "reservation", checkIn: "2027-01-15", checkOut: "2027-01-17", roomIds: ["101"], ...extra
});
const cancellation = (extra = {}) => ({ kind: "cancellation", scope: "single", bookingId: "booking-101", ...extra });

test("write cannot recover missing reservation grounding from raw text or current state", () => {
  assert.equal(validateMutationGrounding({ kind: "reservation", rawText: "reservá del 15 al 17 la 101" }, { rooms: ["101"] }).ok, false);
  assert.equal(validateMutationGrounding({ kind: "reservation", checkIn: "2027-01-15", checkOut: "2027-01-17" }, { rooms: ["101"] }).ok, false);
});

test("complete single and multi reservation grounding is accepted", () => {
  assert.equal(validateMutationGrounding(reservation(), { rooms: ["101"] }).ok, true);
  assert.equal(validateMutationGrounding(reservation({ roomIds: ["101", "102"] }), { rooms: ["101", "102"] }).ok, true);
});

test("duplicate, unknown and stale room grounding fails closed", () => {
  assert.equal(validateMutationGrounding(reservation({ roomIds: ["101", "101"] }), { rooms: ["101", "102"] }).ok, false);
  assert.equal(validateMutationGrounding(reservation({ roomIds: ["999"] }), { rooms: ["101", "102"] }).ok, false);
  assert.equal(validateMutationGrounding(reservation({ roomIds: ["101", "102"] }), { rooms: ["101"] }).ok, false);
});

test("cancellation accepts single/all and rejects missing or mismatched references", () => {
  const active = ["booking-101", "booking-102"];
  assert.equal(validateMutationGrounding(cancellation(), { bookings: active }).ok, true);
  assert.equal(validateMutationGrounding({ kind: "cancellation", scope: "all" }, { bookings: active }).ok, true);
  assert.equal(validateMutationGrounding({ kind: "cancellation", scope: "single" }, { bookings: active }).ok, false);
  assert.equal(validateMutationGrounding(cancellation({ bookingId: "booking-999" }), { bookings: active }).ok, false);
});

test("raw text cannot override structured cancellation grounding", () => {
  const result = validateMutationGrounding(cancellation({ rawText: "cancelá todo el grupo" }), { bookings: ["booking-101", "booking-102"] });
  assert.equal(result.ok, false);
});

test("clarification metadata is machine-observable", () => {
  assert.deepEqual(createClarificationResult("Elegí una reserva", ["booking"]), {
    outcome: "clarification", missing: ["booking"], message: "Elegí una reserva"
  });
});
