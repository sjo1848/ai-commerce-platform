import type { ConversationStore } from "./conversation.js";

export const CONVERSATION_STATE_TOOL_ID = "__conversation_state";

export type StayState = {
  checkIn?: string;
  checkOut?: string;
  guests?: number;
};

export type AvailabilityRoomRef = {
  id: string;
  roomNumber?: string;
};

export type RoomGuestAllocation = {
  roomId: string;
  guests: number;
};

export type ConversationState = {
  stay: StayState;
  /** Backwards-compatible authoritative room ids from the last availability result. */
  availabilityRoomIds: string[];
  /** Authoritative id + human-visible room number pairs from HMS. */
  availabilityRooms: AvailabilityRoomRef[];
  /** Primary/current selection retained for single-room follow-ups. */
  selectedRoomId?: string;
  /** Ordered explicit room selection for multi-room intents. */
  selectedRoomIds: string[];
  /** User-stated party distribution; capacity is NOT validated by HMS yet. */
  roomGuestAllocations: Record<string, number>;
  /** Primary/current booking retained for backwards-compatible cancellation. */
  activeBookingId?: string;
  activeBookingIds: string[];
  bookingStatus?: string;
};

export type ConversationStatePatch = {
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: number | null;
  selectedRoomId?: string | null;
  /** One-based ordinal selected by the LLM; Core resolves it against authoritative HMS candidates. */
  selectedRoomIndex?: number | null;
  /** Human-visible room numbers from the current user turn; Core resolves all-or-none. */
  selectedRoomNumbers?: string[] | null;
  /** One-based ordinals from the current user turn; Core resolves all-or-none. */
  selectedRoomIndexes?: number[] | null;
  /** Human-visible room allocations; Core maps room numbers to authoritative HMS ids. */
  roomGuestAllocations?: Array<{ roomNumber: string; guests: number }> | null;
  activeBookingId?: string | null;
};

export interface ConversationStateStore {
  get(sessionId: string): Promise<ConversationState>;
  put(sessionId: string, state: ConversationState): Promise<void>;
}

export function emptyConversationState(): ConversationState {
  return {
    stay: {},
    availabilityRoomIds: [],
    availabilityRooms: [],
    selectedRoomIds: [],
    roomGuestAllocations: {},
    activeBookingIds: [],
  };
}

export class InMemoryConversationStateStore implements ConversationStateStore {
  private readonly items = new Map<string, ConversationState>();
  async get(sessionId: string): Promise<ConversationState> { return normalizeState(this.items.get(sessionId) ?? emptyConversationState()); }
  async put(sessionId: string, state: ConversationState): Promise<void> { this.items.set(sessionId, normalizeState(state)); }
}

function validIsoDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function validGuests(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20; }
function validSelectionIndex(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 25; }
function stringField(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function roomNumberField(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined; }

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeState(value: ConversationState): ConversationState {
  const next = structuredClone(value) as ConversationState;
  next.stay ??= {};
  next.availabilityRoomIds ??= [];
  next.availabilityRooms ??= next.availabilityRoomIds.map((id) => ({ id }));
  next.selectedRoomIds ??= next.selectedRoomId ? [next.selectedRoomId] : [];
  next.roomGuestAllocations ??= {};
  next.activeBookingIds ??= next.activeBookingId ? [next.activeBookingId] : [];
  return next;
}

function validAuthoritativeRoomIds(values: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(values)) return [];
  return uniqueStrings(values.map(stringField).filter((value): value is string => typeof value === "string" && allowed.includes(value))).slice(0, 25);
}

function parseStoredState(value: unknown): ConversationState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const rawStay = raw.stay && typeof raw.stay === "object" && !Array.isArray(raw.stay) ? raw.stay as Record<string, unknown> : {};
  const state = emptyConversationState();
  if (validIsoDate(rawStay.checkIn)) state.stay.checkIn = rawStay.checkIn;
  if (validIsoDate(rawStay.checkOut)) state.stay.checkOut = rawStay.checkOut;
  if (validGuests(rawStay.guests)) state.stay.guests = Number(rawStay.guests);

  if (Array.isArray(raw.availabilityRooms)) {
    state.availabilityRooms = raw.availabilityRooms.map((room) => {
      if (!room || typeof room !== "object" || Array.isArray(room)) return undefined;
      const record = room as Record<string, unknown>;
      const id = stringField(record.id);
      if (!id) return undefined;
      const roomNumber = stringField(record.roomNumber);
      return { id, ...(roomNumber ? { roomNumber } : {}) };
    }).filter((room): room is AvailabilityRoomRef => Boolean(room)).slice(0, 25);
  }

  if (Array.isArray(raw.availabilityRoomIds)) {
    state.availabilityRoomIds = raw.availabilityRoomIds.map(stringField).filter((value): value is string => typeof value === "string").slice(0, 25);
  }
  if (state.availabilityRoomIds.length === 0 && state.availabilityRooms.length > 0) {
    state.availabilityRoomIds = state.availabilityRooms.map((room) => room.id);
  }
  if (state.availabilityRooms.length === 0 && state.availabilityRoomIds.length > 0) {
    state.availabilityRooms = state.availabilityRoomIds.map((id) => ({ id }));
  }

  state.selectedRoomIds = validAuthoritativeRoomIds(raw.selectedRoomIds, state.availabilityRoomIds);
  const selectedRoomId = stringField(raw.selectedRoomId);
  if (state.selectedRoomIds.length === 0 && selectedRoomId && state.availabilityRoomIds.includes(selectedRoomId)) {
    state.selectedRoomIds = [selectedRoomId];
  }
  if (state.selectedRoomIds.length > 0) {
    const selected = selectedRoomId && state.selectedRoomIds.includes(selectedRoomId) ? selectedRoomId : state.selectedRoomIds[0];
    if (selected) state.selectedRoomId = selected;
  }

  if (raw.roomGuestAllocations && typeof raw.roomGuestAllocations === "object" && !Array.isArray(raw.roomGuestAllocations)) {
    for (const [roomId, guests] of Object.entries(raw.roomGuestAllocations as Record<string, unknown>)) {
      if (state.availabilityRoomIds.includes(roomId) && validGuests(guests)) state.roomGuestAllocations[roomId] = Number(guests);
    }
  }

  state.activeBookingIds = Array.isArray(raw.activeBookingIds)
    ? uniqueStrings(raw.activeBookingIds.map(stringField).filter((value): value is string => typeof value === "string")).slice(0, 25)
    : [];
  const activeBookingId = stringField(raw.activeBookingId);
  if (state.activeBookingIds.length === 0 && activeBookingId) state.activeBookingIds = [activeBookingId];
  if (state.activeBookingIds.length > 0) {
    const active = activeBookingId && state.activeBookingIds.includes(activeBookingId) ? activeBookingId : state.activeBookingIds[0];
    if (active) state.activeBookingId = active;
  }

  const bookingStatus = stringField(raw.bookingStatus);
  if (bookingStatus) state.bookingStatus = bookingStatus;
  return state;
}

export class ConversationBackedStateStore implements ConversationStateStore {
  constructor(private readonly conversation: ConversationStore) {}
  async get(sessionId: string): Promise<ConversationState> {
    const turns = await this.conversation.list(sessionId, 32);
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn?.role !== "tool" || turn.toolId !== CONVERSATION_STATE_TOOL_ID) continue;
      try {
        const parsed = parseStoredState(JSON.parse(turn.content));
        if (parsed) return normalizeState(parsed);
      } catch {}
    }
    return emptyConversationState();
  }
  async put(sessionId: string, state: ConversationState): Promise<void> {
    await this.conversation.append(sessionId, { role: "tool", toolId: CONVERSATION_STATE_TOOL_ID, content: JSON.stringify(normalizeState(state)) });
  }
}

function resolveRoomNumbers(state: ConversationState, values: readonly string[]): string[] | undefined {
  if (values.length === 0) return [];
  const resolved: string[] = [];
  for (const value of values) {
    const target = roomNumberField(value);
    if (!target) return undefined;
    const matches = state.availabilityRooms.filter((room) => roomNumberField(room.roomNumber) === target);
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) return undefined;
    resolved.push(match.id);
  }
  return uniqueStrings(resolved);
}

function resolveRoomIndexes(state: ConversationState, values: readonly number[]): string[] | undefined {
  if (values.length === 0) return [];
  const resolved: string[] = [];
  for (const value of values) {
    if (!validSelectionIndex(value)) return undefined;
    const candidate = state.availabilityRoomIds[value - 1];
    if (!candidate) return undefined;
    resolved.push(candidate);
  }
  return uniqueStrings(resolved);
}

function setSelectedRooms(next: ConversationState, roomIds: readonly string[]): void {
  next.selectedRoomIds = uniqueStrings(roomIds.filter((roomId) => next.availabilityRoomIds.includes(roomId))).slice(0, 25);
  const primary = next.selectedRoomIds[0];
  if (primary) next.selectedRoomId = primary;
  else delete next.selectedRoomId;
  for (const roomId of Object.keys(next.roomGuestAllocations)) {
    if (!next.selectedRoomIds.includes(roomId)) delete next.roomGuestAllocations[roomId];
  }
}

export function applyConversationStatePatch(current: ConversationState, patch: ConversationStatePatch | undefined): ConversationState {
  const next = normalizeState(current);
  if (!patch) return next;
  if (patch.checkIn === null) delete next.stay.checkIn; else if (validIsoDate(patch.checkIn)) next.stay.checkIn = patch.checkIn;
  if (patch.checkOut === null) delete next.stay.checkOut; else if (validIsoDate(patch.checkOut)) next.stay.checkOut = patch.checkOut;
  if (patch.guests === null) delete next.stay.guests; else if (validGuests(patch.guests)) next.stay.guests = patch.guests;

  const clearsSelection = patch.selectedRoomId === null
    || patch.selectedRoomIndex === null
    || patch.selectedRoomNumbers === null
    || patch.selectedRoomIndexes === null;
  if (clearsSelection) setSelectedRooms(next, []);

  if (Array.isArray(patch.selectedRoomNumbers)) {
    const resolved = resolveRoomNumbers(next, patch.selectedRoomNumbers);
    setSelectedRooms(next, resolved ?? []);
  } else if (Array.isArray(patch.selectedRoomIndexes)) {
    const resolved = resolveRoomIndexes(next, patch.selectedRoomIndexes);
    setSelectedRooms(next, resolved ?? []);
  } else if (validSelectionIndex(patch.selectedRoomIndex)) {
    const candidate = next.availabilityRoomIds[patch.selectedRoomIndex - 1];
    setSelectedRooms(next, candidate ? [candidate] : []);
  } else {
    const selected = stringField(patch.selectedRoomId);
    if (selected) setSelectedRooms(next, next.availabilityRoomIds.includes(selected) ? [selected] : []);
  }

  if (patch.roomGuestAllocations === null) {
    next.roomGuestAllocations = {};
  } else if (Array.isArray(patch.roomGuestAllocations)) {
    const allocation: Record<string, number> = {};
    let valid = patch.roomGuestAllocations.length > 0;
    let total = 0;
    const selectedFromAllocation: string[] = [];
    for (const item of patch.roomGuestAllocations) {
      if (!item || typeof item !== "object" || !validGuests(item.guests)) { valid = false; break; }
      const resolved = resolveRoomNumbers(next, [item.roomNumber]);
      const roomId = resolved?.[0];
      if (!roomId || allocation[roomId] !== undefined) { valid = false; break; }
      allocation[roomId] = item.guests;
      total += item.guests;
      selectedFromAllocation.push(roomId);
    }
    if (valid && total >= 1 && total <= 20) {
      next.roomGuestAllocations = allocation;
      if (next.selectedRoomIds.length === 0) setSelectedRooms(next, selectedFromAllocation);
      if (patch.guests === undefined) next.stay.guests = total;
    } else {
      next.roomGuestAllocations = {};
    }
  }

  if (patch.activeBookingId === null) {
    delete next.activeBookingId;
    next.activeBookingIds = [];
  } else {
    const booking = stringField(patch.activeBookingId);
    if (booking && next.activeBookingIds.includes(booking)) {
      next.activeBookingId = booking;
      next.activeBookingIds = uniqueStrings([booking, ...next.activeBookingIds]);
    }
  }
  return next;
}

export function enrichPlanInputFromState(toolId: string, input: unknown, state: ConversationState): unknown {
  const safeState = normalizeState(state);
  const raw = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  if (toolId === "hms.checkAvailability") {
    if (raw.checkIn === undefined && safeState.stay.checkIn) raw.checkIn = safeState.stay.checkIn;
    if (raw.checkOut === undefined && safeState.stay.checkOut) raw.checkOut = safeState.stay.checkOut;
    if (raw.guests === undefined && safeState.stay.guests) raw.guests = safeState.stay.guests;
  }
  if (toolId === "hms.getQuote" || toolId === "hms.createReservation") {
    if (raw.roomId === undefined && safeState.selectedRoomId) raw.roomId = safeState.selectedRoomId;
    if (raw.checkIn === undefined && safeState.stay.checkIn) raw.checkIn = safeState.stay.checkIn;
    if (raw.checkOut === undefined && safeState.stay.checkOut) raw.checkOut = safeState.stay.checkOut;
  }
  if (toolId === "hms.createReservationBundle") {
    if (raw.roomIds === undefined && safeState.selectedRoomIds.length > 1) raw.roomIds = [...safeState.selectedRoomIds];
    if (raw.checkIn === undefined && safeState.stay.checkIn) raw.checkIn = safeState.stay.checkIn;
    if (raw.checkOut === undefined && safeState.stay.checkOut) raw.checkOut = safeState.stay.checkOut;
    if (raw.allocations === undefined && Object.keys(safeState.roomGuestAllocations).length > 0) {
      raw.allocations = safeState.selectedRoomIds
        .filter((roomId) => safeState.roomGuestAllocations[roomId] !== undefined)
        .map((roomId) => ({ roomId, guests: safeState.roomGuestAllocations[roomId] }));
    }
  }
  if (toolId === "hms.cancelReservation" && raw.bookingId === undefined && safeState.activeBookingId) raw.bookingId = safeState.activeBookingId;
  return raw;
}

export function updateConversationStateFromTool(current: ConversationState, toolId: string, input: unknown, data: unknown): ConversationState {
  const next = normalizeState(current);
  const rawInput = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const rawData = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const checkIn = stringField(rawInput.checkIn) ?? stringField(rawData.start);
  const checkOut = stringField(rawInput.checkOut) ?? stringField(rawData.end);
  if (validIsoDate(checkIn)) next.stay.checkIn = checkIn;
  if (validIsoDate(checkOut)) next.stay.checkOut = checkOut;
  if (validGuests(rawInput.guests)) next.stay.guests = Number(rawInput.guests);

  if (toolId === "hms.checkAvailability") {
    const rooms = Array.isArray(rawData.rooms) ? rawData.rooms : [];
    next.availabilityRooms = rooms.map((room) => {
      if (!room || typeof room !== "object" || Array.isArray(room)) return undefined;
      const record = room as Record<string, unknown>;
      const id = stringField(record.id);
      if (!id) return undefined;
      const roomNumber = stringField(record.roomNumber);
      return { id, ...(roomNumber ? { roomNumber } : {}) };
    }).filter((room): room is AvailabilityRoomRef => Boolean(room)).slice(0, 25);
    next.availabilityRoomIds = next.availabilityRooms.map((room) => room.id);
    setSelectedRooms(next, next.selectedRoomIds.filter((roomId) => next.availabilityRoomIds.includes(roomId)));
  }

  const roomId = stringField(rawInput.roomId) ?? stringField(rawData.roomId);
  if ((toolId === "hms.getQuote" || toolId === "hms.createReservation") && roomId && (next.availabilityRoomIds.length === 0 || next.availabilityRoomIds.includes(roomId))) {
    setSelectedRooms(next, [roomId]);
  }

  if (toolId === "hms.createReservationBundle") {
    const roomIds = Array.isArray(rawInput.roomIds)
      ? rawInput.roomIds.map(stringField).filter((value): value is string => typeof value === "string")
      : [];
    if (roomIds.length > 0) setSelectedRooms(next, roomIds);
    const bookings = Array.isArray(rawData.bookings) ? rawData.bookings : [];
    const bookingIds = bookings
      .map((booking) => booking && typeof booking === "object" ? stringField((booking as Record<string, unknown>).bookingId) : undefined)
      .filter((value): value is string => typeof value === "string");
    if (bookingIds.length > 0) {
      next.activeBookingIds = uniqueStrings(bookingIds);
      const primaryBooking = next.activeBookingIds[0];
      if (primaryBooking) next.activeBookingId = primaryBooking;
    }
  }

  const bookingId = stringField(rawData.bookingId);
  if (toolId === "hms.createReservation" && bookingId) {
    next.activeBookingIds = uniqueStrings([bookingId, ...next.activeBookingIds]);
    next.activeBookingId = bookingId;
  }
  if (toolId === "hms.cancelReservation" && bookingId) {
    next.activeBookingIds = next.activeBookingIds.filter((value) => value !== bookingId);
    if (next.activeBookingId === bookingId) {
      const replacement = next.activeBookingIds[0];
      if (replacement) next.activeBookingId = replacement;
      else delete next.activeBookingId;
    }
  }

  const bookingStatus = stringField(rawData.status);
  if ((toolId === "hms.createReservation" || toolId === "hms.createReservationBundle" || toolId === "hms.cancelReservation") && bookingStatus) next.bookingStatus = bookingStatus;
  return next;
}
