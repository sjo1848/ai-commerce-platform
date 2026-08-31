from pathlib import Path

p = Path("src/core/orchestrator.ts")
text = p.read_text()
old = '''    patch.selectedRoomIds !== undefined
    || patch.selectedRoomIndexes !== undefined
    || patch.selectedRoomNumbers !== undefined
    || patch.requestedRoomCount !== undefined'''
new = '''    patch.selectedRoomIds !== undefined
    || patch.selectedRoomIndexes !== undefined
    || patch.selectedRoomNumbers !== undefined
    || patch.selectedRoomRelation !== undefined
    || patch.requestedRoomCount !== undefined'''
if old not in text:
    raise SystemExit("multi-room patch detector target not found")
p.write_text(text.replace(old, new, 1))

p = Path("test/multi-room-conversation-r2.4.test.mjs")
text = p.read_text()
text += r'''

test("critic P2 ambiguous relational message cannot be acknowledged as accepted", async () => {
  const stateStore = new InMemoryConversationStateStore();
  const tenant = { id: "hotel-r24-rel-amb", slug: "hotel-r24-rel-amb", status: "active", allowedToolIds: [], toolPolicies: {} };
  const actor = { id: "visitor-r24-rel-amb", type: "customer", roles: ["customer"], permissions: [] };
  const runtime = new AgentCoreRuntime({
    tenants: [tenant],
    tools: [],
    conversationStateStore: stateStore,
    responder: new DeterministicGroundedResponder(),
    model: {
      async route() {
        return {
          kind: "message",
          purpose: "acknowledgement",
          message: "Perfecto, lo tengo.",
          statePatch: { selectedRoomRelation: "both" },
        };
      },
    },
  });
  const context = await runtime.createContext({ tenantId: tenant.id, actor, channel: "webchat" });
  await stateStore.put(
    context.session.id,
    groundedAvailability(4, { tenantId: tenant.id, actorId: actor.id, sessionId: context.session.id }),
  );

  const result = await runtime.orchestrator.chat("Me quedo con las dos", context);
  assert.match(result.message, /qué habitaciones|qué habitaci[oó]n|opci[oó]n/i);
  assert.doesNotMatch(result.message, /perfecto, lo tengo/i);
  assert.equal(multiRoomConversationIssue(await stateStore.get(context.session.id)), "which_rooms");
});
'''
p.write_text(text)
