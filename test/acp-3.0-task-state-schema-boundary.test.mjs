import test from "node:test";
import assert from "node:assert/strict";
import { reduceTaskState } from "../dist/cognitive/task-state-reducer.js";
import { dependencyFingerprint } from "../dist/cognitive/fingerprint.js";

const NOW = "2026-09-15T04:00:00.000Z";
const emptyTask = () => ({ schemaVersion: "acp-task-state-v1", sessionId: "session-boundary", taskId: "task-boundary", lifecycle: "active", stateRevision: 0, recentEventIds: [], user: { stay: {}, preferences: [] }, observations: { executionResults: [], failures: [] }, control: {}, provenance: {} });
const serverEvent = (state, eventId, payload) => ({ eventId, kind: "server_control", sessionId: state.sessionId, taskId: state.taskId, expectedStateRevision: state.stateRevision, occurredAt: NOW, payload });
const toolEvent = (state, eventId, payload) => ({ eventId, kind: "tool_observation", sessionId: state.sessionId, taskId: state.taskId, expectedStateRevision: state.stateRevision, occurredAt: NOW, payload });
const userEvent = (state, eventId, payload = {}) => ({ eventId, kind: "user_semantic", sessionId: state.sessionId, taskId: state.taskId, expectedStateRevision: state.stateRevision, occurredAt: NOW, payload });

async function pendingAvailability() {
  let state = emptyTask();
  const fp = await dependencyFingerprint({ guests: 2 });
  const recorded = reduceTaskState(state, serverEvent(state, "s1", { kind: "invocation_recorded", invocation: { invocationId: "inv-1", capabilityId: "hotel.availability", status: "admitted", dependencyFingerprint: fp, dependencyPaths: ["lifecycle", "user.stay.guests"], inputSnapshot: { guests: 2 }, admittedAt: NOW, leaseExpiresAt: "2026-09-15T04:05:00.000Z" } }));
  assert.equal(recorded.accepted, true);
  return { state: recorded.state, fp };
}

test("malformed nested availability fails closed without throwing", async () => {
  const { state, fp } = await pendingAvailability();
  const event = toolEvent(state, "t1", { kind: "availability", authority: { kind: "invocation", invocationId: "inv-1", dependencyFingerprint: fp }, observation: { observationId: "broken", status: "observed", source: "tool", dependencyFingerprint: fp, dependencyPaths: ["user.stay.guests"] } });
  let result;
  assert.doesNotThrow(() => { result = reduceTaskState(state, event); });
  assert.equal(result.accepted, false);
  assert.equal(result.rejection, "invalid_tool_authority");
  assert.equal(result.state.observations.availability, undefined);
});

test("provider-specific nested fields cannot enter observations", async () => {
  const { state, fp } = await pendingAvailability();
  const result = reduceTaskState(state, toolEvent(state, "t2", { kind: "availability", authority: { kind: "invocation", invocationId: "inv-1", dependencyFingerprint: fp }, observation: { observationId: "availability-extra", status: "observed", source: "tool", query: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 }, rooms: [{ roomId: "room-101", providerSecret: "no" }], dependencyFingerprint: fp, dependencyPaths: ["user.stay.guests"] } }));
  assert.equal(result.accepted, false);
  assert.equal(result.rejection, "invalid_tool_authority");
});

test("server-control nested extras fail closed", async () => {
  const state = emptyTask();
  const fp = await dependencyFingerprint({ guests: 2 });
  const result = reduceTaskState(state, serverEvent(state, "s-extra", { kind: "invocation_recorded", invocation: { invocationId: "inv-extra", capabilityId: "hotel.availability", status: "admitted", dependencyFingerprint: fp, dependencyPaths: ["lifecycle", "user.stay.guests"], inputSnapshot: {}, admittedAt: NOW, leaseExpiresAt: "2026-09-15T04:05:00.000Z", approvalBypass: true } }));
  assert.equal(result.accepted, false);
  assert.equal(result.rejection, "invalid_server_control");
  assert.equal(result.state.control.pendingToolInvocation, undefined);
});

test("persisted state with undeclared authority fields is rejected before reduction", () => {
  const poisonedRoot = { ...emptyTask(), surprise: true };
  assert.equal(reduceTaskState(poisonedRoot, userEvent(poisonedRoot, "u1")).rejection, "state_invariant_violation");
  const poisonedControl = emptyTask();
  poisonedControl.control = { hiddenAuthority: { approved: true } };
  assert.equal(reduceTaskState(poisonedControl, userEvent(poisonedControl, "u2")).rejection, "state_invariant_violation");
  const poisonedObservation = emptyTask();
  poisonedObservation.observations = { ...poisonedObservation.observations, rawProviderPayload: { ok: true } };
  assert.equal(reduceTaskState(poisonedObservation, userEvent(poisonedObservation, "u3")).rejection, "state_invariant_violation");
});
