from pathlib import Path


def replace(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"target not found: {label}")
    p.write_text(text.replace(old, new, 1))


# The first QA-rework script is applied before this one. This script closes the
# P1 found by fresh QA: an invalid room change must never fall through to a tool
# using the previously grounded room.
replace(
    "src/core/orchestrator.ts",
    """    const selectedRoomIds = canonicalSelectedRoomIds(durableNextState);
    if (route.plan.toolId === \"hms.createReservation\" && (selectedRoomIds.length > 1 || (durableNextState.requestedRoomCount ?? 0) > 1)) {""",
    """    const routeIssue = multiRoomConversationIssue(durableNextState);
    if (routeIssue) {
      const bounded = multiRoomClarification(routeIssue);
      const conversationalContext = modelVisibleConversation(await this.conversation.list(context.session.id, 32));
      const reply = await this.responder.compose({
        kind: \"message\",
        purpose: \"clarification\",
        baseMessage: bounded.message,
        userMessage: normalized,
        missing: bounded.missing,
        conversation: conversationalContext,
        context,
      });
      await this.conversation.append(context.session.id, { role: \"assistant\", content: reply });
      return { message: reply, sessionId: context.session.id };
    }

    const selectedRoomIds = canonicalSelectedRoomIds(durableNextState);
    if (route.plan.toolId === \"hms.createReservation\" && (selectedRoomIds.length > 1 || (durableNextState.requestedRoomCount ?? 0) > 1)) {""",
    "block all tools on unresolved room state",
)

# Preserve a previously grounded valid selection when a correction is invalid,
# but require clarification. This is safer than silently switching or executing
# the old selection, and the orchestrator now blocks tools while the marker lives.
replace(
    "test/conversation-state.test.mjs",
    """  const staleSelection = applyConversationStatePatch({ ...current, selectedRoomId: roomId }, { selectedRoomIndex: 3 });
  assert.equal(staleSelection.selectedRoomId, undefined);
  const validSecond = applyConversationStatePatch(current, { selectedRoomIndex: 2 });""",
    """  const staleSelection = applyConversationStatePatch({ ...current, selectedRoomId: roomId }, { selectedRoomIndex: 3 });
  assert.equal(staleSelection.selectedRoomId, roomId);
  assert.equal(multiRoomConversationIssue(staleSelection), \"which_rooms\");
  const validSecond = applyConversationStatePatch(current, { selectedRoomIndex: 2 });""",
    "legacy invalid selection now preserves prior grounding but blocks use",
)

replace(
    "test/multi-room-conversation-r2.4.test.mjs",
    """test(\"ADV-102 unknown room numbers and out-of-range ordinals fail closed\", () => {
  const current = applyConversationStatePatch(groundedAvailability(4), { selectedRoomNumbers: [\"101\", \"102\"] });
  const unknown = applyConversationStatePatch(current, { selectedRoomNumbers: [\"101\", \"999\"] });
  assert.deepEqual(canonicalSelectedRoomIds(unknown), []);
  const outOfRange = applyConversationStatePatch(current, { selectedRoomIndexes: [1, 99] });
  assert.deepEqual(canonicalSelectedRoomIds(outOfRange), []);
});""",
    """test(\"ADV-102 unknown room numbers and out-of-range ordinals fail closed\", () => {
  const current = applyConversationStatePatch(groundedAvailability(4), { selectedRoomNumbers: [\"101\", \"102\"] });
  const unknown = applyConversationStatePatch(current, { selectedRoomNumbers: [\"101\", \"999\"] });
  assert.deepEqual(canonicalSelectedRoomIds(unknown), [room101, room102]);
  assert.equal(multiRoomConversationIssue(unknown), \"which_rooms\");
  const outOfRange = applyConversationStatePatch(current, { selectedRoomIndexes: [1, 99] });
  assert.deepEqual(canonicalSelectedRoomIds(outOfRange), [room101, room102]);
  assert.equal(multiRoomConversationIssue(outOfRange), \"which_rooms\");
});""",
    "ADV-102 preserve but clarify semantics",
)

p = Path("test/multi-room-conversation-r2.4.test.mjs")
text = p.read_text()
text += r'''

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
'''
p.write_text(text)
