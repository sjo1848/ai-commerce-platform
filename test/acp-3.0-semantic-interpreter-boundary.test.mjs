import test from "node:test";
import assert from "node:assert/strict";
import {
  admitInterpreterOutput,
  buildTrustedInterpreterInput,
  materializeInterpreterArtifacts,
} from "../dist/cognitive/semantic-interpreter.js";

function state() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-i4",
    taskId: "task-i4",
    lifecycle: "active",
    stateRevision: 4,
    recentEventIds: [],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 4 },
      preferences: [],
      operationIntent: "reserve",
    },
    observations: {
      availability: {
        observationId: "obs-secret",
        status: "observed",
        source: "tool",
        query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 4 },
        rooms: [
          { roomId: "internal-room-101", roomNumber: "101", roomType: "Double", capacity: 2 },
          { roomId: "internal-room-102", roomNumber: "102", roomType: "Double", capacity: 2 },
        ],
        dependencyFingerprint: "fp-secret-availability",
        dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      },
      executionResults: [],
      failures: [],
    },
    control: {
      groundedSelection: {
        roomIds: ["internal-room-101"],
        sourceObservationId: "obs-secret",
        authority: "server",
        dependencyFingerprint: "fp-secret-selection",
        dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
      },
      preparedOperation: {
        operationId: "op-secret",
        operationType: "reserve",
        operationFingerprint: "opfp-secret",
        inputSnapshot: { roomId: "internal-room-101" },
        status: "approval_required",
        dependencyFingerprint: "fp-secret-operation",
        dependencyPaths: ["control.groundedSelection", "user.operationIntent"],
      },
      dialogueAnchor: {
        anchorId: "anchor-secret",
        kind: "selection",
        createdAtStateRevision: 4,
        dependencyFingerprint: "fp-secret-anchor",
        dependencyPaths: ["observations.availability"],
        candidateScope: ["internal-room-101", "internal-room-102"],
      },
    },
    provenance: {},
  };
}

function input(overrides = {}) {
  return buildTrustedInterpreterInput({
    currentUserMessage: "reservame la segunda",
    state: state(),
    temporalContext: {
      trustedNow: "2026-09-15T01:30:00-03:00",
      timezone: "America/Argentina/Mendoza",
      locale: "es-AR",
      temporalPolicyId: "hotel-temporal-v1@1",
    },
    presentedEntities: [
      { kind: "room", label: "Habitación 101" },
      { kind: "room", label: "Habitación 102" },
    ],
    focusedOrdinal: 2,
    ...overrides,
  });
}

const validTask = () => ({
  classification: "task",
  taskSemanticChanges: {
    requestedSelectionReference: { op: "set", value: { kind: "ordinal", value: 2 } },
    operationIntent: { op: "set", value: "reserve" },
  },
});

test("trusted projection does not expose operational IDs, fingerprints, raw availability or prepared input", () => {
  const projected = input();
  const serialized = JSON.stringify(projected);
  for (const forbidden of ["internal-room-101", "internal-room-102", "obs-secret", "fp-secret", "op-secret", "opfp-secret", "inputSnapshot", "candidateScope"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(projected.taskContext.hasGroundedSelection, true);
  assert.equal(projected.taskContext.groundedSelectionCount, 1);
  assert.equal(projected.presentationContext.entities[1].label, "Habitación 102");
});

test("closed output admits bounded task semantics", () => {
  const result = admitInterpreterOutput(validTask(), input());
  assert.equal(result.ok, true);
});

test("null patch semantics are rejected instead of meaning clear", () => {
  const raw = validTask();
  raw.taskSemanticChanges.operationIntent = null;
  assert.deepEqual(admitInterpreterOutput(raw, input()), { ok: false, rejection: "invalid_output_schema" });
});

test("unknown top-level fields reject the whole output", () => {
  const raw = { ...validTask(), toolId: "hms.createReservation" };
  assert.deepEqual(admitInterpreterOutput(raw, input()), { ok: false, rejection: "invalid_output_schema" });
});

test("valid semantics plus prohibited nested operational field are not partially salvaged", () => {
  const raw = validTask();
  raw.taskSemanticChanges.requestedSelectionReference = {
    op: "set",
    value: { kind: "ordinal", value: 2, roomId: "internal-room-102" },
  };
  assert.deepEqual(admitInterpreterOutput(raw, input()), { ok: false, rejection: "invalid_output_schema" });
});

test("internal room grounding shape is outside the Interpreter schema", () => {
  const raw = validTask();
  raw.taskSemanticChanges.requestedSelectionReference = { op: "set", value: { kind: "room_id", value: "internal-room-102" } };
  assert.deepEqual(admitInterpreterOutput(raw, input()), { ok: false, rejection: "invalid_output_schema" });
});

test("abort requires operationIntent clear in the same admitted output", () => {
  const missingClear = {
    classification: "task",
    directives: { abortCurrentOperation: true },
  };
  assert.deepEqual(admitInterpreterOutput(missingClear, input()), { ok: false, rejection: "invalid_semantic_combination" });

  const valid = {
    classification: "task",
    taskSemanticChanges: { operationIntent: { op: "clear" } },
    directives: { abortCurrentOperation: true },
  };
  assert.equal(admitInterpreterOutput(valid, input()).ok, true);
});

test("commit may be admitted before final room grounding", () => {
  const noSelectionState = state();
  delete noSelectionState.control.groundedSelection;
  const projected = buildTrustedInterpreterInput({
    currentUserMessage: "reservame una habitación",
    state: noSelectionState,
    temporalContext: input().temporalContext,
  });
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      requestedGoal: { op: "set", value: "reservation" },
      operationIntent: { op: "set", value: "reserve" },
    },
  };
  assert.equal(admitInterpreterOutput(raw, projected).ok, true);
});

test("contextual focused reference requires bounded focused presentation context", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      requestedSelectionReference: { op: "set", value: { kind: "contextual_anchor", role: "focused_entity" } },
    },
  };
  assert.equal(admitInterpreterOutput(raw, input()).ok, true);
  const withoutPresentation = buildTrustedInterpreterInput({
    currentUserMessage: "esa",
    state: state(),
    temporalContext: input().temporalContext,
  });
  assert.deepEqual(admitInterpreterOutput(raw, withoutPresentation), { ok: false, rejection: "invalid_contextual_reference" });
});

test("ordered occupancy is admitted only with anchor/selection and must agree with known guests", () => {
  const good = {
    classification: "task",
    taskSemanticChanges: {
      requestedOccupancy: { op: "set", value: { kind: "ordered_distribution", guestsPerRoom: [2, 2] } },
    },
  };
  assert.equal(admitInterpreterOutput(good, input()).ok, true);

  const mismatch = structuredClone(good);
  mismatch.taskSemanticChanges.requestedOccupancy.value.guestsPerRoom = [1, 2];
  assert.deepEqual(admitInterpreterOutput(mismatch, input()), { ok: false, rejection: "invalid_semantic_combination" });
});

test("explicit occupancy assignments cannot smuggle operational room IDs", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      requestedOccupancy: {
        op: "set",
        value: {
          kind: "explicit_assignments",
          assignments: [{ room: { kind: "room_id", value: "internal-room-101" }, guests: 2 }],
        },
      },
    },
  };
  assert.deepEqual(admitInterpreterOutput(raw, input()), { ok: false, rejection: "invalid_output_schema" });
});

test("temporal provenance is bound to trusted context and exact normalized patches", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: {
      stay: {
        checkIn: { op: "set", value: "2026-09-16" },
        checkOut: { op: "set", value: "2026-09-17" },
      },
    },
    temporalResolutionProvenance: {
      expressionClass: "relative",
      trustedNow: "2026-09-15T01:30:00-03:00",
      timezone: "America/Argentina/Mendoza",
      policyId: "hotel-temporal-v1@1",
      normalized: { checkIn: "2026-09-16", checkOut: "2026-09-17" },
    },
  };
  assert.equal(admitInterpreterOutput(raw, input()).ok, true);
  const spoofed = structuredClone(raw);
  spoofed.temporalResolutionProvenance.timezone = "UTC";
  assert.deepEqual(admitInterpreterOutput(spoofed, input()), { ok: false, rejection: "invalid_temporal_provenance" });
});

test("invalid calendar dates fail schema admission", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: { stay: { checkIn: { op: "set", value: "2027-02-30" } } },
  };
  assert.deepEqual(admitInterpreterOutput(raw, input()), { ok: false, rejection: "invalid_output_schema" });
});

test("read request and commit can coexist without tool routing", () => {
  const raw = {
    classification: "task",
    taskSemanticChanges: { operationIntent: { op: "set", value: "reserve" } },
    directives: { readRequest: { kind: "quote", target: "current_selection" } },
  };
  const admitted = admitInterpreterOutput(raw, input());
  assert.equal(admitted.ok, true);
  const artifacts = materializeInterpreterArtifacts(admitted.output, {
    eventId: "user-event-1",
    sessionId: "session-i4",
    taskId: "task-i4",
    expectedStateRevision: 4,
    occurredAt: "2026-09-15T04:40:00.000Z",
  });
  assert.equal(artifacts.userSemanticEvent.payload.operationIntent.value, "reserve");
  assert.deepEqual(artifacts.planningTrigger.readDirective, { kind: "quote", target: "current_selection" });
});

test("semantic retry target never materializes a tool id", () => {
  const raw = { classification: "task", directives: { retry: { targetOperation: "availability" } } };
  const admitted = admitInterpreterOutput(raw, input());
  assert.equal(admitted.ok, true);
  const artifacts = materializeInterpreterArtifacts(admitted.output, {
    eventId: "user-event-2",
    sessionId: "session-i4",
    taskId: "task-i4",
    expectedStateRevision: 4,
    occurredAt: "2026-09-15T04:41:00.000Z",
  });
  assert.deepEqual(artifacts.planningTrigger.retryDirective, { targetOperation: "availability" });
  assert.equal(artifacts.userSemanticEvent, undefined);
});

test("compare_price normalizes only to semantic Planner directive, not a capability", () => {
  const raw = { classification: "task", directives: { readRequest: { kind: "compare_price", target: "presented_set" } } };
  const admitted = admitInterpreterOutput(raw, input());
  assert.equal(admitted.ok, true);
  const artifacts = materializeInterpreterArtifacts(admitted.output, {
    eventId: "user-event-3",
    sessionId: "session-i4",
    taskId: "task-i4",
    expectedStateRevision: 4,
    occurredAt: "2026-09-15T04:42:00.000Z",
  });
  assert.deepEqual(artifacts.planningTrigger.readDirective, { kind: "compare", target: "presented_set" });
});

test("social/help classification cannot carry task state mutation", () => {
  const raw = {
    classification: "help",
    taskSemanticChanges: { operationIntent: { op: "set", value: "reserve" } },
  };
  assert.deepEqual(admitInterpreterOutput(raw, input()), { ok: false, rejection: "invalid_semantic_combination" });
});

test("provider failure/absence is rejection and creates no semantic fallback", () => {
  assert.deepEqual(admitInterpreterOutput(undefined, input()), { ok: false, rejection: "invalid_output_schema" });
  assert.deepEqual(admitInterpreterOutput("reservar", input()), { ok: false, rejection: "invalid_output_schema" });
});

test("server-owned envelope fields come only from materialization metadata while origin identity stays bound", () => {
  const admitted = admitInterpreterOutput(validTask(), input());
  assert.equal(admitted.ok, true);
  const artifacts = materializeInterpreterArtifacts(admitted.output, {
    eventId: "trusted-event",
    sessionId: "session-i4",
    taskId: "task-i4",
    expectedStateRevision: 4,
    occurredAt: "2026-09-15T04:43:00.000Z",
    causationId: "ingress-1",
  });
  assert.equal(artifacts.userSemanticEvent.eventId, "trusted-event");
  assert.equal(artifacts.userSemanticEvent.sessionId, "session-i4");
  assert.equal(artifacts.userSemanticEvent.taskId, "task-i4");
  assert.equal(artifacts.userSemanticEvent.expectedStateRevision, 4);
  assert.equal(artifacts.userSemanticEvent.causationId, "ingress-1");
  assert.equal(artifacts.planningTrigger.acceptedEventId, "trusted-event");
});
