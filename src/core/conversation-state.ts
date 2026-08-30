export type StayState = {
  checkIn?: string;
  checkOut?: string;
  guests?: number;
};

export type ConversationState = {
  stay: StayState;
  availabilityRoomIds: string[];
  selectedRoomId?: string;
  activeBookingId?: string;
  bookingStatus?: string;
};

export type ConversationStatePatch = {
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: number | null;
  selectedRoomId?: string | null;
  activeBookingId?: string | null;
};

export interface ConversationStateStore {
  get(sessionId: string): Promise<ConversationState>;
  put(sessionId: string, state: ConversationState): Promise<void>;
}

export function emptyConversationState(): ConversationState {
  return { stay: {}, availabilityRoomIds: [] };
}

export class InMemoryConversationStateStore implements ConversationStateStore {
  private readonly items = new Map<string, ConversationState>();

  async get(sessionId: string): Promise<ConversationState> {
    return structuredClone(this.items.get(sessionId) ?? emptyConversationState());
  }

  async put(sessionId: string, state: ConversationState): Promise<void> {
    this.items.set(sessionId, structuredClone(state));
  }
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validGuests(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function applyConversationStatePatch(
  current: ConversationState,
  patch: ConversationStatePatch | undefined,
): ConversationState {
  if (!patch) return structuredClone(current);
  const next = structuredClone(current);

  if (patch.checkIn === null) delete next.stay.checkIn;
  else if (validIsoDate(patch.checkIn)) next.stay.checkIn = patch.checkIn;

  if (patch.checkOut === null) delete next.stay.checkOut;
  else if (validIsoDate(patch.checkOut)) next.stay.checkOut = patch.checkOut;

  if (patch.guests === null) delete next.stay.guests;
  else if (validGuests(patch.guests)) next.stay.guests = patch.guests;

  if (patch.selectedRoomId === null) delete next.selectedRoomId;
  else {
    const selected = stringField(patch.selectedRoomId);
    if (selected && next.availabilityRoomIds.includes(selected)) next.selectedRoomId = selected;
  }

  if (patch.activeBookingId === null) delete next.activeBookingId;
  else {
    const booking = stringField(patch.activeBookingId);
    if (booking && booking === current.activeBookingId) next.activeBookingId = booking;
  }

  return next;
}

export function enrichPlanInputFromState(toolId: string, input: unknown, state: ConversationState): unknown {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? { ...(input as Record<string, unknown>) }
    : {};

  if (toolId === "hms.checkAvailability") {
    if (raw.checkIn === undefined && state.stay.checkIn) raw.checkIn = state.stay.checkIn;
    if (raw.checkOut === undefined && state.stay.checkOut) raw.checkOut = state.stay.checkOut;
    if (raw.guests === undefined && state.stay.guests) raw.guests = state.stay.guests;
  }
  if (toolId === "hms.getQuote" || toolId === "hms.createReservation") {
    if (raw.roomId === undefined && state.selectedRoomId) raw.roomId = state.selectedRoomId;
    if (raw.checkIn === undefined && state.stay.checkIn) raw.checkIn = state.stay.checkIn;
    if (raw.checkOut === undefined && state.stay.checkOut) raw.checkOut = state.stay.checkOut;
  }
  if (toolId === "hms.cancelReservation") {
    if (raw.bookingId === undefined && state.activeBookingId) raw.bookingId = state.activeBookingId;
  }
  return raw;
}

export function updateConversationStateFromTool(
  current: ConversationState,
  toolId: string,
  input: unknown,
  data: unknown,
): ConversationState {
  const next = structuredClone(current);
  const rawInput = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const rawData = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};

  const checkIn = stringField(rawInput.checkIn) ?? stringField(rawData.start);
  const checkOut = stringField(rawInput.checkOut) ?? stringField(rawData.end);
  if (validIsoDate(checkIn)) next.stay.checkIn = checkIn;
  if (validIsoDate(checkOut)) next.stay.checkOut = checkOut;
  if (validGuests(rawInput.guests)) next.stay.guests = Number(rawInput.guests);

  if (toolId === "hms.checkAvailability") {
    const rooms = Array.isArray(rawData.rooms) ? rawData.rooms : [];
    next.availabilityRoomIds = rooms
      .map((room) => room && typeof room === "object" ? stringField((room as Record<string, unknown>).id) : undefined)
      .filter((value): value is string => Boolean(value));
    if (next.selectedRoomId && !next.availabilityRoomIds.includes(next.selectedRoomId)) delete next.selectedRoomId;
  }

  const roomId = stringField(rawInput.roomId) ?? stringField(rawData.roomId);
  if ((toolId === "hms.getQuote" || toolId === "hms.createReservation") && roomId) {
    if (next.availabilityRoomIds.length === 0 || next.availabilityRoomIds.includes(roomId)) next.selectedRoomId = roomId;
  }

  const bookingId = stringField(rawData.bookingId);
  if (toolId === "hms.createReservation" && bookingId) next.activeBookingId = bookingId;
  if ((toolId === "hms.createReservation" || toolId === "hms.cancelReservation") && stringField(rawData.status)) {
    next.bookingStatus = stringField(rawData.status);
  }

  return next;
}
