import test from "node:test";
import assert from "node:assert/strict";
import { createOrchestrationCycleRecord, runHotelPlanningCycle } from "../dist/cognitive/orchestration-cycle.js";
import { resolveHotelReferences } from "../dist/cognitive/reference-resolver.js";
import { hotelDomainCapabilities } from "../dist/cognitive/hotel-task-definition.js";

const NOW = "2026-09-15T22:20:00.000Z";
const capabilities = hotelDomainCapabilities();

function selectionState() {
  return {
    schemaVersion: "acp-task-state-v1",
    sessionId: "session-context",
    taskId: "task-context",
    lifecycle: "active",
    stateRevision: 7,
    recentEventIds: [],
    user: {
      requestedGoal: "reservation",
      stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
      preferences: [],
      requestedSelectionReference: { kind: "room_number", value: "101" },
    },
    observations: {
      availability: {
        observationId: "availability-context",
        status: "observed",
        source: "tool",
        query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
        rooms: [
          { roomId: "room-101", roomNumber: "101", capacity: 2 },
          { roomId: "room-102", roomNumber: "102", capacity: 2 },
        ],
        dependencyFingerprint: "availability-context-fp",
        dependencyPaths: ["user.stay.checkIn", "user.stay.checkOut", "user.stay.guests"],
      },
      executionResults: [],
      failures: [],
    },
    control: {
      groundedSelection: {
        roomIds: ["room-101"],
        sourceObservationId: "availability-context",
        authority: "server",
        dependencyFingerprint: "grounded-context-old",
        dependencyPaths: ["observations.availability", "user.requestedSelectionReference"],
      },
      dialogueAnchor: {
        anchorId: "anchor-context",
        kind: "selection",
        createdAtStateRevision: 7,
        dependencyFingerprint: "anchor-context-fp",
        dependencyPaths: ["observations.availability"],
        referencedObservationId: "availability-context",
        candidateScope: ["room-101", "room-102"],
        focusedCandidate: "room-102",
        selectedCandidates: ["room-101"],
      },
    },
    provenance: {},
  };
}

function userReferenceEvent(reference, id) {
  return {
    eventId: id,
    kind: "user_semantic",
    sessionId: "session-context",
    taskId: "task-context",
    expectedStateRevision: 7,
    occurredAt: NOW,
    payload: { requestedSelectionReference: { op: "set", value: reference } },
  };
}

async function runReference(reference, id) {
  const event = userReferenceEvent(reference, id);
  const trigger = { origin: "user", acceptedEventId: id };
  return runHotelPlanningCycle({
    state: selectionState(),
    primaryEvent: event,
    trigger,
    cycle: createOrchestrationCycleRecord({ cycleId: `cycle-${id}`, trigger, createdAt: NOW }),
    capabilities,
    now: NOW,
  });
}

test("current_selection resolves from published DialogueAnchor after Reducer invalidates old operational grounding", async () => {
  const result = await runReference({ kind: "contextual_anchor", role: "current_selection" }, "user-current-selection");
  assert.equal(result.kind, "planned");
  assert.equal(result.primaryReduction.state.control.groundedSelection, undefined);
  assert.equal(result.internalGroundingEvents.length, 1);
  assert.deepEqual(result.state.control.groundedSelection.roomIds, ["room-101"]);
  assert.ok(result.state.control.groundedSelection.dependencyPaths.includes("control.dialogueAnchor"));
});

test("focused_entity resolves only from explicit published focus, not candidate ordering", async () => {
  const result = await runReference({ kind: "contextual_anchor", role: "focused_entity" }, "user-focused-selection");
  assert.equal(result.kind, "planned");
  assert.deepEqual(result.state.control.groundedSelection.roomIds, ["room-102"]);
});

test("relation other uses published selected candidate and two-item presented scope after old grounding is invalidated", async () => {
  const result = await runReference({ kind: "relation", value: "other" }, "user-other-selection");
  assert.equal(result.kind, "planned");
  assert.equal(result.primaryReduction.state.control.groundedSelection, undefined);
  assert.deepEqual(result.state.control.groundedSelection.roomIds, ["room-102"]);
});

test("relation other fails closed if published anchor lacks an explicit current selection", async () => {
  const initial = selectionState();
  delete initial.control.dialogueAnchor.selectedCandidates;
  initial.user.requestedSelectionReference = { kind: "relation", value: "other" };
  delete initial.control.groundedSelection;
  const resolution = await resolveHotelReferences(initial);
  assert.equal(resolution.instructions.length, 0);
  assert.equal(resolution.diagnostics.find((entry) => entry.target === "room").status, "unresolved");
});

test("anchor focus/selection outside candidateScope is rejected by resolver", async () => {
  const initial = selectionState();
  initial.control.dialogueAnchor.focusedCandidate = "room-injected";
  initial.user.requestedSelectionReference = { kind: "contextual_anchor", role: "focused_entity" };
  delete initial.control.groundedSelection;
  const resolution = await resolveHotelReferences(initial);
  assert.equal(resolution.instructions.length, 0);
});

test("booking contextual reference cannot reuse room anchor identifiers", async () => {
  const initial = selectionState();
  initial.user.bookingReference = { kind: "contextual_anchor", role: "current_selection" };
  initial.observations.booking = {
    observationId: "booking-observation",
    status: "confirmed",
    source: "tool",
    bookingId: "BK-123",
    dependencyFingerprint: "booking-fp",
    dependencyPaths: ["user.bookingReference"],
  };
  const resolution = await resolveHotelReferences(initial);
  assert.equal(resolution.instructions.filter((instruction) => instruction.kind === "booking_reference_grounded").length, 0);
});
