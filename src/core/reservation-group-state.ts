import type { ConversationStore } from "./conversation.js";

export const RESERVATION_GROUP_STATE_TOOL_ID = "__reservation_group_state";

export type ReservationGroupState = {
  activeBookingIds: string[];
  revision: number;
  status?: "confirmed" | "partial_failure" | "compensation_failed";
};

export interface ReservationGroupStateStore {
  get(sessionId: string): Promise<ReservationGroupState>;
  put(sessionId: string, state: ReservationGroupState): Promise<void>;
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= 10) break;
  }
  return result;
}

function parseState(value: unknown): ReservationGroupState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const activeBookingIds = normalizeIds(raw.activeBookingIds);
  const revision = Number.isInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : undefined;
  if (revision === undefined) return undefined;
  const status = raw.status === "confirmed" || raw.status === "partial_failure" || raw.status === "compensation_failed"
    ? raw.status
    : undefined;
  return { activeBookingIds, revision, ...(status ? { status } : {}) };
}

export function emptyReservationGroupState(): ReservationGroupState {
  return { activeBookingIds: [], revision: 0 };
}

export class ConversationBackedReservationGroupStateStore implements ReservationGroupStateStore {
  constructor(private readonly conversation: ConversationStore) {}

  async get(sessionId: string): Promise<ReservationGroupState> {
    const turns = await this.conversation.list(sessionId, 32);
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn?.role !== "tool" || turn.toolId !== RESERVATION_GROUP_STATE_TOOL_ID) continue;
      try {
        const parsed = parseState(JSON.parse(turn.content));
        if (parsed) return parsed;
      } catch {
        continue;
      }
    }
    return emptyReservationGroupState();
  }

  async put(sessionId: string, state: ReservationGroupState): Promise<void> {
    const normalized = parseState(state) ?? emptyReservationGroupState();
    await this.conversation.append(sessionId, {
      role: "tool",
      toolId: RESERVATION_GROUP_STATE_TOOL_ID,
      content: JSON.stringify(normalized),
    });
  }
}
