import type { ConversationStore } from "./conversation.js";

export const RESERVATION_GROUP_STATE_TOOL_ID = "__reservation_group_state";

export type ReservationGroupBooking = {
  bookingId: string;
  roomId?: string;
  roomNumber?: string;
};

export type ReservationGroupState = {
  activeBookingIds: string[];
  activeBookings: ReservationGroupBooking[];
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

function normalizeBookings(values: unknown): ReservationGroupBooking[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: ReservationGroupBooking[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const raw = value as Record<string, unknown>;
    const bookingId = typeof raw.bookingId === "string" ? raw.bookingId.trim() : "";
    if (!bookingId || seen.has(bookingId)) continue;
    const roomId = typeof raw.roomId === "string" ? raw.roomId.trim() : "";
    const roomNumber = typeof raw.roomNumber === "string" ? raw.roomNumber.trim() : "";
    seen.add(bookingId);
    result.push({
      bookingId,
      ...(roomId ? { roomId } : {}),
      ...(roomNumber ? { roomNumber } : {}),
    });
    if (result.length >= 10) break;
  }
  return result;
}

function parseState(value: unknown): ReservationGroupState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const parsedBookings = normalizeBookings(raw.activeBookings);
  const parsedIds = normalizeIds(raw.activeBookingIds);
  const activeBookingIds = parsedIds.length > 0 ? parsedIds : parsedBookings.map((booking) => booking.bookingId);
  const bookingById = new Map(parsedBookings.map((booking) => [booking.bookingId, booking]));
  const activeBookings = activeBookingIds.map((bookingId) => bookingById.get(bookingId) ?? { bookingId });
  const revision = Number.isInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : undefined;
  if (revision === undefined) return undefined;
  const status = raw.status === "confirmed" || raw.status === "partial_failure" || raw.status === "compensation_failed"
    ? raw.status
    : undefined;
  return { activeBookingIds, activeBookings, revision, ...(status ? { status } : {}) };
}

export function emptyReservationGroupState(): ReservationGroupState {
  return { activeBookingIds: [], activeBookings: [], revision: 0 };
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
