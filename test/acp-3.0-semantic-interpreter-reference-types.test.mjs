import test from "node:test";
import assert from "node:assert/strict";
import { admitInterpreterOutput, buildTrustedInterpreterInput } from "../dist/cognitive/semantic-interpreter.js";

function state({ roomSelection = false, bookingTarget = false } = {}) {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-ref-type",
    taskId: "task-ref-type",
    lifecycle: "active",
    stateRevision: 3,
    recentEventIds: [],
    user: { requestedGoal: "reservation", stay: {}, preferences: [] },
    observations: { executionResults: [], failures: [] },
    control: {
      ...(roomSelection ? {
        groundedSelection: {
          roomIds: ["room-internal-1"], sourceObservationId: "obs-room", authority: "server",
          dependencyFingerprint: "fp-room", dependencyPaths: ["observations.availability"],
        },
      } : {}),
      ...(bookingTarget ? {
        groundedBookingTarget: {
          bookingId: "booking-internal-1", sourceObservationId: "obs-booking", authority: "server",
          dependencyFingerprint: "fp-booking", dependencyPaths: ["observations.booking"],
        },
      } : {}),
      dialogueAnchor: {
        anchorId: "anchor-ref", kind: "selection", createdAtStateRevision: 3,
        dependencyPaths: ["observations.availability"],
      },
    },
    provenance: {},
  };
}

const temporalContext = {
  trustedNow: "2026-09-15T18:27:00-03:00",
  timezone: "America/Argentina/Mendoza",
  locale: "es-AR",
  temporalPolicyId: "hotel-temporal-v1@1",
};

function projected({ entityKind = "room", roomSelection = false, bookingTarget = false } = {}) {
  return buildTrustedInterpreterInput({
    currentUserMessage: "esa",
    state: state({ roomSelection, bookingTarget }),
    temporalContext,
    presentedEntities: [{ kind: entityKind, label: entityKind === "booking" ? "Reserva BK-1" : "Habitación 101" }],
    focusedOrdinal: 1,
  });
}

test("focused room reference requires a focused room, not a booking", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      requestedSelectionReference: { op: "set", value: { kind: "contextual_anchor", role: "focused_entity" } },
    },
  };
  assert.equal(admitInterpreterOutput(raw, projected({ entityKind: "room" })).ok, true);
  assert.deepEqual(
    admitInterpreterOutput(raw, projected({ entityKind: "booking" })),
    { ok: false, rejection: "invalid_contextual_reference" },
  );
});

test("focused booking reference requires a focused booking, not a room", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      requestedGoal: { op: "set", value: "cancellation" },
      bookingReference: { op: "set", value: { kind: "contextual_anchor", role: "focused_entity" } },
    },
  };
  assert.equal(admitInterpreterOutput(raw, projected({ entityKind: "booking" })).ok, true);
  assert.deepEqual(
    admitInterpreterOutput(raw, projected({ entityKind: "room" })),
    { ok: false, rejection: "invalid_contextual_reference" },
  );
});

test("current_selection is typed independently for room and booking references", () => {
  const roomRaw = {
    classification: "task",
    taskSemanticChanges: {
      requestedSelectionReference: { op: "set", value: { kind: "contextual_anchor", role: "current_selection" } },
    },
  };
  assert.equal(admitInterpreterOutput(roomRaw, projected({ roomSelection: true })).ok, true);
  assert.deepEqual(
    admitInterpreterOutput(roomRaw, projected({ bookingTarget: true })),
    { ok: false, rejection: "invalid_contextual_reference" },
  );

  const bookingRaw = {
    classification: "task",
    taskSemanticChanges: {
      requestedGoal: { op: "set", value: "cancellation" },
      bookingReference: { op: "set", value: { kind: "contextual_anchor", role: "current_selection" } },
    },
  };
  assert.equal(admitInterpreterOutput(bookingRaw, projected({ bookingTarget: true })).ok, true);
  assert.deepEqual(
    admitInterpreterOutput(bookingRaw, projected({ roomSelection: true })),
    { ok: false, rejection: "invalid_contextual_reference" },
  );
});

test("presented_set room reference rejects mixed or non-room presentation sets", () => {
  const input = buildTrustedInterpreterInput({
    currentUserMessage: "las dos",
    state: state(),
    temporalContext,
    presentedEntities: [
      { kind: "room", label: "Habitación 101" },
      { kind: "booking", label: "Reserva BK-1" },
    ],
    focusedOrdinal: 1,
  });
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      requestedSelectionReference: { op: "set", value: { kind: "contextual_anchor", role: "presented_set" } },
    },
  };
  assert.deepEqual(admitInterpreterOutput(raw, input), { ok: false, rejection: "invalid_contextual_reference" });
});
