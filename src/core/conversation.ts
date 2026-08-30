import type { ModelConversationTurn } from "./types.js";

export interface ConversationStore {
  list(sessionId: string, limit?: number): Promise<ModelConversationTurn[]>;
  append(sessionId: string, turn: ModelConversationTurn): Promise<void>;
}

const MODEL_HIDDEN_KEYS = new Set([
  "tenantid",
  "hotelid",
  "actorid",
  "guestid",
  "roles",
  "permissions",
  "humanapproved",
  "approvedoperationfingerprint",
  "operationtoken",
  "idempotencykey",
  "requestid",
  "traceid",
  "sessionid",
]);

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sanitizeModelValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth-limited]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 1_000);
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeModelValue(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (MODEL_HIDDEN_KEYS.has(normalizedKey(key))) continue;
      output[key] = sanitizeModelValue(nested, depth + 1);
    }
    return output;
  }
  return undefined;
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

/**
 * Model-facing projection of tool results. Operational identifiers needed for
 * references (roomId/bookingId) remain, while trusted routing/execution metadata
 * is removed before persistence in conversational memory.
 */
export function serializeToolResult(result: unknown): string {
  try {
    const serialized = JSON.stringify(sanitizeModelValue(result));
    return serialized.length <= 4_000 ? serialized : `${serialized.slice(0, 3_980)}…[truncated]`;
  } catch {
    return "{\"result\":\"unserializable\"}";
  }
}
