import test from "node:test";
import assert from "node:assert/strict";
import {
  applyConversationStatePatch,
  canonicalSelectedRoomIds,
  emptyConversationState,
  enrichPlanInputFromState,
  mergeConcurrentConversationState,
  multiRoomConversationIssue,
  updateConversationStateFromTool,
  InMemoryConversationStateStore,
} from "../dist/core/conversation-state.js";
import { AgentCoreRuntime } from "../dist/core/runtime.js";
import { DeterministicGroundedResponder } from "../dist/core/model-responder.js";
import { LLMModelRouter } from "../dist/core/llm-model.js";
import { DeterministicModelRouter } from "../dist/core/deterministic-model.js";

const room101 = "11000000-0000-0000-0000-000000000101";
const room102 = "11000000-0000-0000-0000-000000000102";
const room103 = "11000000-0000-0000-0000-000000000103";
const scope = { tenantId: "hotel-r24", actorId: "visitor-r24", sessionId: "session-r24" };

function groundedAvailability(guests = 5, memoryScope = scope) {
  return updateConversationStateFromTool(
    { ...emptyConversationState(), stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests }, semanticMemory: { revision: 0, stay: {}, preferences: [], scope: memoryScope } },
    "hms.checkAvailability",
    { checkIn: "2027-01-15", checkOut: "2027-01-17", guests },
    { rooms: [
      { id: room101, roomNumber: "101", roomType: "Standard" },
      { id: room102, roomNumber: "102", roomType: "Standard" },
      { id: room103, roomNumber: "103", roomType: "Suite" },
    ] },
  );
}

test("MR-101 exact room numbers resolve to two authoritative candidates without single-room collapse", () => {
  const selected = applyConversationStatePatch(groundedAvailability(4), { selectedRoomNumbers: ["101", "102"] });
  assert.deepEqual(canonicalSelectedRoomIds(selected), [room101, room102]);
  assert.equal(selected.selectedRoomId, undefined);
  assert.equal(selected.requestedRoomCount, 2);
});

test("MR-102 two ordinals resolve server-side in availability order", () => {
  const selected = applyConversationStatePatch(groundedAvailability(4), { selectedRoomIndexes: [1, 2] });
  assert.deepEqual(canonicalSelectedRoomIds(selected), [room101, room102]);
});

test("MR-104 replacement keeps unaffected room and drops replaced occupancy", () => {
  const first = applyConversationStatePatch(groundedAvailability(4), {
    selectedRoomNumbers: ["101", "102"],
    roomOccupancy: [{ roomNumber: "101", guests: 2 }, { roomNumber: "102", guests: 2 }],
  });
  const replaced = applyConversationStatePatch(first, { selectedRoomNumbers: ["101", "103"] });
  assert.deepEqual(canonicalSelectedRoomIds(replaced), [room101, room103]);
  assert.deepEqual(replaced.roomOccupancy, [{ roomId: room101, guests: 2 }]);
});

test("MR-103 consistent explicit occupancy is preserved and validated against total guests", () => {
  const selected = applyConversationStatePatch(groundedAvailability(5), {
    selectedRoomNumbers: ["101", "102"],
    roomOccupancy: [{ roomNumber: "101", guests: 2 }, { roomNumber: "102", guests: 3 }],
  });
  assert.deepEqual(selected.roomOccupancy, [{ roomId: room101, guests: 2 }, { roomId: room102, guests: 3 }]);
  assert.equal(multiRoomConversationIssue(selected), undefined);
});

test("CLR-102 inconsistent occupancy is clarification-worthy and never auto-completed", () => {
  const selected = applyConversationStatePatch(groundedAvailability(5), {
    selectedRoomNumbers: ["101", "102"],
    roomOccupancy: [{ roomNumber: "101", guests: 2 }, { roomNumber: "102", guests: 2 }],
  });
  assert.equal(multiRoomConversationIssue(selected), "occupancy_distribution");
  assert.equal(selected.roomOccupancy.reduce((sum, item) => sum + item.guests, 0), 4);
});

test("CLR-101 requested room count without exact rooms remains unresolved rather than choosing candidates", () => {
  const state = applyConversationStatePatch(groundedAvailability(5), { requestedRoomCount: 2 });
  assert.deepEqual(canonicalSelectedRoomIds(state), []);
  assert.equal(state.requestedRoomCount, 2);
  assert.equal(multiRoomConversationIssue(state), "which_rooms");
});

test("ADV-102 unknown room numbers and out-of-range ordinals fail closed", () => {
  const current = applyConversationStatePatch(groundedAvailability(4), { selectedRoomNumbers: ["101", "102"] });
  const unknown = applyConversationStatePatch(current, { selectedRoomNumbers: ["101", "999"] });
  assert.deepEqual(canonicalSelectedRoomIds(unknown), [room101, room102]);
  assert.equal(multiRoomConversationIssue(unknown), "which_rooms");
  const outOfRange = applyConversationStatePatch(current, { selectedRoomIndexes: [1, 99] });
  assert.deepEqual(canonicalSelectedRoomIds(outOfRange), [room101, room102]);
  assert.equal(multiRoomConversationIssue(outOfRange), "which_rooms");
});

test("concurrent equal-revision room selections conflict once and stale replay cannot reverse winner", () => {
  const base = groundedAvailability(4);
  const left = applyConversationStatePatch(base, { selectedRoomNumbers: ["101", "102"] });
  const right = applyConversationStatePatch(base, { selectedRoomNumbers: ["101", "103"] });
  assert.equal(left.roomSelectionRevision, right.roomSelectionRevision);
  const merged = mergeConcurrentConversationState(left, right);
  assert.deepEqual(canonicalSelectedRoomIds(merged), [room101, room103]);
  assert.ok((merged.roomSelectionRevision ?? 0) > (right.roomSelectionRevision ?? 0));
  const replay = mergeConcurrentConversationState(merged, left);
  assert.deepEqual(canonicalSelectedRoomIds(replay), [room101, room103]);
  assert.equal(replay.roomSelectionRevision, merged.roomSelectionRevision);
});

test("single-room plan enrichment remains compatible while multi-room selection never collapses", () => {
  const single = applyConversationStatePatch(groundedAvailability(2), { selectedRoomNumbers: ["101"] });
  assert.deepEqual(enrichPlanInputFromState("hms.getQuote", {}, single), { roomId: room101, checkIn: "2027-01-15", checkOut: "2027-01-17" });
  const multi = applyConversationStatePatch(groundedAvailability(4), { selectedRoomNumbers: ["101", "102"] });
  assert.deepEqual(enrichPlanInputFromState("hms.createReservation", {}, multi), { checkIn: "2027-01-15", checkOut: "2027-01-17" });
});

test("LLM router accepts natural multi-room numbers as bounded state and exposes candidate number mapping", async () => {
  let systemPrompt = "";
  const provider = {
    async completeStructured(request) {
      systemPrompt = request.messages[0].content;
      return {
        value: { kind: "message", toolId: "", input: {}, clarificationReason: "acknowledgement", missing: [], statePatch: { selectedRoomNumbers: ["101", "102"] } },
        model: "fake", inputTokens: 10, outputTokens: 10, latencyMs: 1, estimatedCostUsd: 0,
      };
    },
  };
  const router = new LLMModelRouter(provider, new DeterministicModelRouter());
  const state = groundedAvailability(4);
  const result = await router.route("Quiero la 101 y la 102", { now: "2026-08-31T12:00:00-03:00", tenant: { id: "hotel-r24" } }, [], [], state);
  assert.equal(result.kind, "message");
  assert.deepEqual(result.statePatch.selectedRoomNumbers, ["101", "102"]);
  assert.match(systemPrompt, /roomNumber":"101/);
});

test("orchestrator turns requested room count into a selection-only clarification without repeating stay facts", async () => {
  const stateStore = new InMemoryConversationStateStore();
  const tenant = { id: "hotel-r24", slug: "hotel-r24", status: "active", allowedToolIds: [], toolPolicies: {} };
  const actor = { id: "visitor-r24", type: "customer", roles: ["customer"], permissions: [] };
  const runtime = new AgentCoreRuntime({
    tenants: [tenant], tools: [], conversationStateStore: stateStore, responder: new DeterministicGroundedResponder(),
    model: { async route() { return { kind: "message", purpose: "acknowledgement", message: "Perfecto, lo tengo.", statePatch: { requestedRoomCount: 2 } }; } },
  });
  const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  await stateStore.put(context.session.id, groundedAvailability(5, { tenantId: tenant.id, actorId: actor.id, sessionId: context.session.id }));
  const result = await runtime.orchestrator.chat("Quiero dos habitaciones", context);
  assert.match(result.message, /qué habitaciones/i);
  assert.doesNotMatch(result.message, /fecha|persona/i);
  assert.equal((await stateStore.get(context.session.id)).requestedRoomCount, 2);
});

test("orchestrator blocks multi-room createReservation in R2.4 even when model asks for the single-room tool", async () => {
  let executions = 0;
  const stateStore = new InMemoryConversationStateStore();
  const tenant = { id: "hotel-r24-write", slug: "hotel-r24-write", status: "active", allowedToolIds: ["hms.createReservation"], toolPolicies: { "hms.createReservation": "approval" } };
  const actor = { id: "visitor-r24", type: "customer", roles: ["customer"], permissions: ["hms.reservation.write"] };
  const tool = {
    id: "hms.createReservation", primitive: "RESERVE", description: "reservation", risk: "write", sideEffect: "reversible", requiredPermissions: ["hms.reservation.write"],
    inputSchema: { type: "object", properties: { roomId: {}, checkIn: {}, checkOut: {} }, required: ["roomId", "checkIn", "checkOut"] },
    validateInput(input) { return input?.roomId ? { ok: true, value: input } : { ok: false, message: "room required" }; },
    async execute() { executions += 1; return { bookingId: "should-not-run", status: "CONFIRMED" }; },
  };
  const runtime = new AgentCoreRuntime({
    tenants: [tenant], tools: [tool], conversationStateStore: stateStore, responder: new DeterministicGroundedResponder(),
    model: { async route() { return { kind: "tool", plan: { toolId: "hms.createReservation", input: {} }, statePatch: { selectedRoomNumbers: ["101", "102"] } }; } },
  });
  const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  await stateStore.put(context.session.id, groundedAvailability(4, { tenantId: tenant.id, actorId: actor.id, sessionId: context.session.id }));
  const result = await runtime.orchestrator.chat("Reservame la 101 y la 102", context);
  assert.match(result.message, /reserva conjunta|varias habitaciones/i);
  assert.equal(executions, 0);
  assert.deepEqual(canonicalSelectedRoomIds(await stateStore.get(context.session.id)), [room101, room102]);
});


test("natural relation las dos resolves only when exactly two HMS candidates exist", () => {
  const twoCandidates = updateConversationStateFromTool(
    { ...emptyConversationState(), stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 4 }, semanticMemory: { revision: 0, stay: {}, preferences: [], scope } },
    "hms.checkAvailability",
    { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 4 },
    { rooms: [{ id: room101, roomNumber: "101" }, { id: room102, roomNumber: "102" }] },
  );
  const selected = applyConversationStatePatch(twoCandidates, { selectedRoomRelation: "both" });
  assert.deepEqual(canonicalSelectedRoomIds(selected), [room101, room102]);
  assert.equal(multiRoomConversationIssue(selected), undefined);

  const ambiguous = applyConversationStatePatch(groundedAvailability(4), { selectedRoomRelation: "both" });
  assert.deepEqual(canonicalSelectedRoomIds(ambiguous), []);
  assert.equal(multiRoomConversationIssue(ambiguous), "which_rooms");
});

test("natural relation la otra replaces one selection only when the other candidate is unambiguous", () => {
  const twoCandidates = updateConversationStateFromTool(
    { ...emptyConversationState(), stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 }, semanticMemory: { revision: 0, stay: {}, preferences: [], scope } },
    "hms.checkAvailability",
    { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    { rooms: [{ id: room101, roomNumber: "101" }, { id: room102, roomNumber: "102" }] },
  );
  const first = applyConversationStatePatch(twoCandidates, { selectedRoomNumbers: ["101"] });
  const other = applyConversationStatePatch(first, { selectedRoomRelation: "other" });
  assert.deepEqual(canonicalSelectedRoomIds(other), [room102]);
  assert.equal(other.selectedRoomId, room102);

  const threeFirst = applyConversationStatePatch(groundedAvailability(2), { selectedRoomNumbers: ["101"] });
  const ambiguous = applyConversationStatePatch(threeFirst, { selectedRoomRelation: "other" });
  assert.deepEqual(canonicalSelectedRoomIds(ambiguous), [room101]);
  assert.equal(multiRoomConversationIssue(ambiguous), "which_rooms");
});

test("unknown room reference preserves prior grounded selection and forces clarification", () => {
  const selected = applyConversationStatePatch(groundedAvailability(4), { selectedRoomNumbers: ["101", "102"] });
  const invalid = applyConversationStatePatch(selected, { selectedRoomNumbers: ["101", "999"] });
  assert.deepEqual(canonicalSelectedRoomIds(invalid), [room101, room102]);
  assert.equal(multiRoomConversationIssue(invalid), "which_rooms");
});

test("invalid occupancy reference is never silently accepted", () => {
  const selected = applyConversationStatePatch(groundedAvailability(5), { selectedRoomNumbers: ["101", "102"] });
  const invalid = applyConversationStatePatch(selected, {
    roomOccupancy: [{ roomNumber: "101", guests: 2 }, { roomNumber: "999", guests: 3 }],
  });
  assert.deepEqual(invalid.roomOccupancy, []);
  assert.equal(multiRoomConversationIssue(invalid), "occupancy_distribution");
});

test("LLM router accepts bounded relational references and defines las dos / la otra ambiguity", async () => {
  let prompt = "";
  const provider = {
    async completeStructured(request) {
      prompt = request.messages[0].content;
      return {
        value: { kind: "message", toolId: "", input: {}, clarificationReason: "acknowledgement", missing: [], statePatch: { selectedRoomRelation: "both" } },
        model: "fake", inputTokens: 10, outputTokens: 5, latencyMs: 1, estimatedCostUsd: 0,
      };
    },
  };
  const router = new LLMModelRouter(provider, new DeterministicModelRouter());
  const result = await router.route("Me quedo con las dos", { now: "2026-08-31T12:00:00-03:00", tenant: { id: "hotel-r24" } }, [], [], groundedAvailability(4));
  assert.equal(result.kind, "message");
  assert.equal(result.statePatch.selectedRoomRelation, "both");
  assert.match(prompt, /las dos/i);
  assert.match(prompt, /la otra/i);
  assert.match(prompt, /never choose arbitrarily/i);
});


test("P1 invalid room correction cannot execute a tool using prior grounded room", async () => {
  let executions = 0;
  const stateStore = new InMemoryConversationStateStore();
  const tenant = { id: "hotel-r24-p1", slug: "hotel-r24-p1", status: "active", allowedToolIds: ["hms.getQuote"], toolPolicies: {} };
  const actor = { id: "visitor-r24-p1", type: "customer", roles: ["customer"], permissions: [] };
  const tool = {
    id: "hms.getQuote", primitive: "QUOTE", description: "quote", risk: "read", sideEffect: "none", requiredPermissions: [],
    inputSchema: { type: "object", properties: { roomId: {}, checkIn: {}, checkOut: {} }, required: ["roomId", "checkIn", "checkOut"] },
    validateInput(input) { return input?.roomId ? { ok: true, value: input } : { ok: false, message: "room required" }; },
    async execute(input) { executions += 1; return { roomId: input.roomId, totalCents: 10000, currency: "ARS" }; },
  };
  const runtime = new AgentCoreRuntime({
    tenants: [tenant], tools: [tool], conversationStateStore: stateStore, responder: new DeterministicGroundedResponder(),
    model: { async route() { return { kind: "tool", plan: { toolId: "hms.getQuote", input: {} }, statePatch: { selectedRoomNumbers: ["999"] } }; } },
  });
  const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  const scoped = groundedAvailability(2, { tenantId: tenant.id, actorId: actor.id, sessionId: context.session.id });
  await stateStore.put(context.session.id, applyConversationStatePatch(scoped, { selectedRoomNumbers: ["101"] }));

  const result = await runtime.orchestrator.chat("Mejor la 999, ¿cuánto sale?", context);
  assert.match(result.message, /qué habitaci[oó]n|opci[oó]n|identificar/i);
  assert.equal(executions, 0);
  const after = await stateStore.get(context.session.id);
  assert.deepEqual(canonicalSelectedRoomIds(after), [room101]);
  assert.equal(multiRoomConversationIssue(after), "which_rooms");
});
