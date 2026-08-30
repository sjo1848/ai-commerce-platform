import type { ModelConversationTurn } from "./types.js";

export interface ConversationStore {
  list(sessionId: string, limit?: number): Promise<ModelConversationTurn[]>;
  append(sessionId: string, turn: ModelConversationTurn): Promise<void>;
}

function sanitizeTurn(turn: ModelConversationTurn): ModelConversationTurn {
  const content = turn.content.trim().slice(0, 4_000);
  if (!content) throw new Error("Conversation turn content is required");
  return {
    role: turn.role,
    content,
    ...(turn.toolId ? { toolId: turn.toolId.slice(0, 200) } : {}),
  };
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly items = new Map<string, ModelConversationTurn[]>();

  constructor(private readonly maxTurns = 32) {}

  async list(sessionId: string, limit = 12): Promise<ModelConversationTurn[]> {
    const turns = this.items.get(sessionId) ?? [];
    return structuredClone(turns.slice(-Math.max(0, Math.min(limit, this.maxTurns))));
  }

  async append(sessionId: string, turn: ModelConversationTurn): Promise<void> {
    const turns = this.items.get(sessionId) ?? [];
    turns.push(sanitizeTurn(turn));
    if (turns.length > this.maxTurns) turns.splice(0, turns.length - this.maxTurns);
    this.items.set(sessionId, turns);
  }
}

export function serializeToolResult(result: unknown): string {
  try {
    const serialized = JSON.stringify(result);
    return serialized.length <= 4_000 ? serialized : `${serialized.slice(0, 3_980)}…[truncated]`;
  } catch {
    return "{\"result\":\"unserializable\"}";
  }
}
