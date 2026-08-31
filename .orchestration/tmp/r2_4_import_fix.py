from pathlib import Path

p = Path("test/conversation-state.test.mjs")
text = p.read_text()
old = 'import { applyConversationStatePatch, ConversationBackedStateStore, InMemoryConversationStateStore } from "../dist/core/conversation-state.js";'
new = 'import { applyConversationStatePatch, ConversationBackedStateStore, InMemoryConversationStateStore, multiRoomConversationIssue } from "../dist/core/conversation-state.js";'
if old not in text:
    raise SystemExit("conversation-state import target not found")
p.write_text(text.replace(old, new, 1))
