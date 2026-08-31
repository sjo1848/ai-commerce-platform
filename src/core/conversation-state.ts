import { CoreError } from "./errors.js";
import type { ConversationStore } from "./conversation.js";

export const CONVERSATION_STATE_TOOL_ID = "__conversation_state";

export type ConversationIntent = "availability" | "quote" | "reservation" | "cancellation";
export type SemanticMemorySource = "user" | "tool" | "server" | "legacy";

export type ConversationMemoryScope = {
  tenantId: string;
  actorId: string;
  sessionId: string;
};

export type SemanticFactProvenance = {
  source: SemanticMemorySource;
  revision: number;
};

export type StoredPreference = {
  value: string;
  source: "user" | "legacy";
  revision: number;
};

export type SemanticMemory = {
  revision: number;
  scope?: ConversationMemoryScope;
  stay: {
    checkIn?: SemanticFactProvenance;
    checkOut?: SemanticFactProvenance;
    guests?: SemanticFactProvenance;
  };
  preferences: StoredPreference[];
  activeIntent?: {
    value: ConversationIntent;
    source: "user" | "server" | "legacy";
    revision: number;
  };
};

export type StayState = {
  checkIn?: string;
  checkOut?: string;
  guests?: number;
};

export type ConversationState = {
  stay: StayState;
  semanticMemory: SemanticMemory;
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
  /** One-based ordinal selected by the LLM; Core resolves it against authoritative HMS candidates. */
  selectedRoomIndex?: number | null;
  activeBookingId?: string | null;
};

export type UserSemanticMemoryUpdate = {
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: number | null;
  preferences?: string[];
  clearPreferences?: boolean;
  activeIntent?: ConversationIntent;
};

export interface ConversationStateStore {
  get(sessionId: string): Promise<ConversationState>;
  put(sessionId: string, state: ConversationState): Promise<void>;
}

function emptySemanticMemory(): SemanticMemory {
  return { revision: 0, stay: {}, preferences: [] };
}

export function emptyConversationState(): ConversationState {
  return { stay: {}, semanticMemory: emptySemanticMemory(), availabilityRoomIds: [] };
}

export class InMemoryConversationStateStore implements ConversationStateStore {
  private readonly items = new Map<string, ConversationState>();
  async get(sessionId: string): Promise<ConversationState> { return structuredClone(this.items.get(sessionId) ?? emptyConversationState()); }
  async put(sessionId: string, state: ConversationState): Promise<void> { this.items.set(sessionId, structuredClone(state)); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function validGuests(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20; }
function validSelectionIndex(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 25; }
function stringField(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function validRevision(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function validMemorySource(value: unknown): value is SemanticMemorySource { return value === "user" || value === "tool" || value === "server" || value === "legacy"; }
function validIntent(value: unknown): value is ConversationIntent { return value === "availability" || value === "quote" || value === "reservation" || value === "cancellation"; }

function ensureSemanticMemory(state: ConversationState): SemanticMemory {
  const candidate = (state as ConversationState & { semanticMemory?: SemanticMemory }).semanticMemory;
  if (candidate && isRecord(candidate) && validRevision(candidate.revision) && isRecord(candidate.stay) && Array.isArray(candidate.preferences)) return candidate;
  const memory = emptySemanticMemory();
  (state as ConversationState & { semanticMemory: SemanticMemory }).semanticMemory = memory;
  return memory;
}

function parseProvenance(value: unknown): SemanticFactProvenance | undefined {
  if (!isRecord(value) || !validMemorySource(value.source) || !validRevision(value.revision)) return undefined;
  return { source: value.source, revision: value.revision };
}

function parseStoredState(value: unknown): ConversationState | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value;
  const rawStay = isRecord(raw.stay) ? raw.stay : {};
  const state = emptyConversationState();
  if (validIsoDate(rawStay.checkIn)) state.stay.checkIn = rawStay.checkIn;
  if (validIsoDate(rawStay.checkOut)) state.stay.checkOut = rawStay.checkOut;
  if (validGuests(rawStay.guests)) state.stay.guests = Number(rawStay.guests);
  if (Array.isArray(raw.availabilityRoomIds)) state.availabilityRoomIds = raw.availabilityRoomIds.map(stringField).filter((v): v is string => Boolean(v)).slice(0, 25);
  const selectedRoomId = stringField(raw.selectedRoomId);
  if (selectedRoomId && state.availabilityRoomIds.includes(selectedRoomId)) state.selectedRoomId = selectedRoomId;
  const activeBookingId = stringField(raw.activeBookingId);
  if (activeBookingId) state.activeBookingId = activeBookingId;
  const bookingStatus = stringField(raw.bookingStatus);
  if (bookingStatus) state.bookingStatus = bookingStatus;

  const rawMemory = isRecord(raw.semanticMemory) ? raw.semanticMemory : {};
  const memory = emptySemanticMemory();
  if (validRevision(rawMemory.revision)) memory.revision = rawMemory.revision;
  if (isRecord(rawMemory.scope)) {
    const tenantId = stringField(rawMemory.scope.tenantId);
    const actorId = stringField(rawMemory.scope.actorId);
    const sessionId = stringField(rawMemory.scope.sessionId);
    if (tenantId && actorId && sessionId) memory.scope = { tenantId, actorId, sessionId };
  }
  const rawMemoryStay = isRecord(rawMemory.stay) ? rawMemory.stay : {};
  const checkInMeta = parseProvenance(rawMemoryStay.checkIn);
  const checkOutMeta = parseProvenance(rawMemoryStay.checkOut);
  const guestsMeta = parseProvenance(rawMemoryStay.guests);
  if (checkInMeta && state.stay.checkIn) memory.stay.checkIn = checkInMeta;
  if (checkOutMeta && state.stay.checkOut) memory.stay.checkOut = checkOutMeta;
  if (guestsMeta && state.stay.guests !== undefined) memory.stay.guests = guestsMeta;

  if (Array.isArray(rawMemory.preferences)) {
    const seen = new Set<string>();
    for (const item of rawMemory.preferences) {
      if (!isRecord(item)) continue;
      const preference = stringField(item.value);
      const source = item.source === "user" || item.source === "legacy" ? item.source : undefined;
      const revision = validRevision(item.revision) ? item.revision : undefined;
      if (!preference || !source || revision === undefined) continue;
      const key = normalizeText(preference);
      if (seen.has(key)) continue;
      seen.add(key);
      memory.preferences.push({ value: preference.slice(0, 120), source, revision });
      if (memory.preferences.length >= 8) break;
    }
  }
  if (isRecord(rawMemory.activeIntent) && validIntent(rawMemory.activeIntent.value) && validRevision(rawMemory.activeIntent.revision)) {
    const source = rawMemory.activeIntent.source;
    if (source === "user" || source === "server" || source === "legacy") {
      memory.activeIntent = { value: rawMemory.activeIntent.value, source, revision: rawMemory.activeIntent.revision };
    }
  }

  // Backward-compatible migration: old snapshots had stay values but no provenance.
  if (state.stay.checkIn && !memory.stay.checkIn) memory.stay.checkIn = { source: "legacy", revision: memory.revision };
  if (state.stay.checkOut && !memory.stay.checkOut) memory.stay.checkOut = { source: "legacy", revision: memory.revision };
  if (state.stay.guests !== undefined && !memory.stay.guests) memory.stay.guests = { source: "legacy", revision: memory.revision };
  state.semanticMemory = memory;
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
        if (parsed) return parsed;
      } catch {}
    }
    return emptyConversationState();
  }
  async put(sessionId: string, state: ConversationState): Promise<void> {
    await this.conversation.append(sessionId, { role: "tool", toolId: CONVERSATION_STATE_TOOL_ID, content: JSON.stringify(state) });
  }
}

export function bindConversationStateScope(current: ConversationState, scope: ConversationMemoryScope): ConversationState {
  const next = structuredClone(current);
  const memory = ensureSemanticMemory(next);
  const existing = memory.scope;
  if (existing && (existing.tenantId !== scope.tenantId || existing.actorId !== scope.actorId || existing.sessionId !== scope.sessionId)) {
    throw new CoreError("FORBIDDEN", "Conversation semantic memory scope mismatch", 403);
  }
  memory.scope = { ...scope };
  return next;
}

function semanticSourceForStay(existing: SemanticFactProvenance | undefined, incoming: SemanticMemorySource): SemanticMemorySource {
  if (incoming === "tool" && existing?.source === "user") return "user";
  if (incoming === "legacy" && existing) return existing.source;
  return incoming;
}

export type ApplyConversationStateOptions = {
  semanticSource?: SemanticMemorySource;
  preferences?: readonly string[];
  clearPreferences?: boolean;
  activeIntent?: ConversationIntent | null;
  activeIntentSource?: "user" | "server" | "legacy";
};

export function applyConversationStatePatch(
  current: ConversationState,
  patch: ConversationStatePatch | undefined,
  options: ApplyConversationStateOptions = {},
): ConversationState {
  const next = structuredClone(current);
  const memory = ensureSemanticMemory(next);
  const source = options.semanticSource ?? "legacy";
  const changedStay = new Set<keyof StayState>();
  const clearedStay = new Set<keyof StayState>();

  const setDate = (field: "checkIn" | "checkOut", value: string | null | undefined) => {
    if (value === undefined) return;
    if (value === null) {
      if (next.stay[field] !== undefined || memory.stay[field] !== undefined) {
        delete next.stay[field];
        clearedStay.add(field);
      }
      return;
    }
    if (!validIsoDate(value)) return;
    const existingMeta = memory.stay[field];
    const provenanceUpgrade = source === "user" && existingMeta?.source !== "user";
    if (next.stay[field] !== value || provenanceUpgrade || !existingMeta) {
      next.stay[field] = value;
      changedStay.add(field);
    }
  };
  const setGuests = (value: number | null | undefined) => {
    if (value === undefined) return;
    if (value === null) {
      if (next.stay.guests !== undefined || memory.stay.guests !== undefined) {
        delete next.stay.guests;
        clearedStay.add("guests");
      }
      return;
    }
    if (!validGuests(value)) return;
    const existingMeta = memory.stay.guests;
    const provenanceUpgrade = source === "user" && existingMeta?.source !== "user";
    if (next.stay.guests !== value || provenanceUpgrade || !existingMeta) {
      next.stay.guests = value;
      changedStay.add("guests");
    }
  };

  setDate("checkIn", patch?.checkIn);
  setDate("checkOut", patch?.checkOut);
  setGuests(patch?.guests);

  if (patch?.selectedRoomId === null || patch?.selectedRoomIndex === null) delete next.selectedRoomId;
  const selectionIndex = patch?.selectedRoomIndex;
  if (validSelectionIndex(selectionIndex)) {
    const candidate = next.availabilityRoomIds[selectionIndex - 1];
    if (candidate) next.selectedRoomId = candidate;
    else delete next.selectedRoomId;
  } else {
    const selected = stringField(patch?.selectedRoomId);
    if (selected && next.availabilityRoomIds.includes(selected)) next.selectedRoomId = selected;
  }

  if (patch?.activeBookingId === null) delete next.activeBookingId;
  else {
    const booking = stringField(patch?.activeBookingId);
    if (booking && booking === current.activeBookingId) next.activeBookingId = booking;
  }

  const cleanPreferences = (options.preferences ?? []).map(sanitizePreference).filter((value): value is string => Boolean(value));
  const existingPreferenceKeys = new Set(memory.preferences.map((item) => normalizeText(item.value)));
  const addedPreferences = cleanPreferences.filter((value) => !existingPreferenceKeys.has(normalizeText(value)));
  const preferencesWillClear = Boolean(options.clearPreferences && memory.preferences.length > 0);
  const activeIntentWillClear = options.activeIntent === null && memory.activeIntent !== undefined;
  const activeIntentSource = options.activeIntentSource ?? (source === "server" ? "server" : source === "legacy" ? "legacy" : "user");
  const activeIntentWillChange = options.activeIntent !== undefined && options.activeIntent !== null && (
    memory.activeIntent?.value !== options.activeIntent || memory.activeIntent.source !== activeIntentSource
  );

  const semanticChanged = changedStay.size > 0 || clearedStay.size > 0 || preferencesWillClear || addedPreferences.length > 0 || activeIntentWillClear || activeIntentWillChange;
  if (semanticChanged) {
    const revision = memory.revision + 1;
    memory.revision = revision;
    for (const field of clearedStay) delete memory.stay[field];
    for (const field of changedStay) {
      const existing = memory.stay[field];
      memory.stay[field] = { source: semanticSourceForStay(existing, source), revision };
    }
    if (preferencesWillClear) memory.preferences = [];
    for (const preference of addedPreferences) {
      memory.preferences.push({ value: preference, source: "user", revision });
    }
    if (memory.preferences.length > 8) memory.preferences = memory.preferences.slice(-8);
    if (activeIntentWillClear) delete memory.activeIntent;
    if (options.activeIntent !== undefined && options.activeIntent !== null && activeIntentWillChange) {
      memory.activeIntent = { value: options.activeIntent, source: activeIntentSource, revision };
    }
  }
  return next;
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const MONTHS: Readonly<Record<string, number>> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20,
};
const NUMBER_TOKEN = "(?:\\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte)";

function parseCountToken(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = normalizeText(value);
  const numeric = /^\d{1,2}$/.test(normalized) ? Number(normalized) : NUMBER_WORDS[normalized];
  return validGuests(numeric) ? numeric : undefined;
}

function formatIsoDate(year: number, month: number, day: number): string | undefined {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validIsoDate(value) ? value : undefined;
}

function addUtcDays(iso: string, days: number): string | undefined {
  if (!validIsoDate(iso) || !Number.isInteger(days) || days < 1 || days > 30) return undefined;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function extractDateRange(message: string, current: Readonly<ConversationState>): { checkIn: string; checkOut: string } | undefined {
  const text = normalizeText(message);
  const iso = message.match(/\b\d{4}-\d{2}-\d{2}\b/g)?.filter(validIsoDate) ?? [];
  if (iso.length >= 2) return { checkIn: iso[0]!, checkOut: iso[1]! };

  const slashMatches = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)];
  if (slashMatches.length >= 2) {
    const first = slashMatches[0]!; const second = slashMatches[1]!;
    const checkIn = formatIsoDate(Number(first[3]), Number(first[2]), Number(first[1]));
    const checkOut = formatIsoDate(Number(second[3]), Number(second[2]), Number(second[1]));
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }

  const monthNames = Object.keys(MONTHS).join("|");
  const fullRange = text.match(new RegExp(`\\b(?:del|de)?\\s*(\\d{1,2})\\s+(?:al|a)\\s+(\\d{1,2})\\s+de\\s+(${monthNames})\\s+(?:de\\s+)?(\\d{4})\\b`, "i"));
  if (fullRange) {
    const month = MONTHS[fullRange[3]!];
    const checkIn = month ? formatIsoDate(Number(fullRange[4]), month, Number(fullRange[1])) : undefined;
    const checkOut = month ? formatIsoDate(Number(fullRange[4]), month, Number(fullRange[2])) : undefined;
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }

  const start = text.match(new RegExp(`\\b(?:a partir del|desde el|desde)\\s+(\\d{1,2})\\s+de\\s+(${monthNames})\\s+(?:de\\s+)?(\\d{4})\\b`, "i"));
  const nights = text.match(new RegExp(`\\b(${NUMBER_TOKEN})\\s+noches?\\b`, "i"));
  if (start && nights) {
    const month = MONTHS[start[2]!];
    const count = parseCountToken(nights[1]);
    const checkIn = month ? formatIsoDate(Number(start[3]), month, Number(start[1])) : undefined;
    const checkOut = checkIn && count ? addUtcDays(checkIn, count) : undefined;
    if (checkIn && checkOut) return { checkIn, checkOut };
  }

  const partialRange = text.match(/\b(?:del|de)?\s*(\d{1,2})\s+(?:al|a)\s+(\d{1,2})\b/i);
  if (partialRange && current.stay.checkIn && current.stay.checkOut && current.stay.checkIn.slice(0, 7) === current.stay.checkOut.slice(0, 7)) {
    const year = Number(current.stay.checkIn.slice(0, 4));
    const month = Number(current.stay.checkIn.slice(5, 7));
    const checkIn = formatIsoDate(year, month, Number(partialRange[1]));
    const checkOut = formatIsoDate(year, month, Number(partialRange[2]));
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }
  return undefined;
}

const CLEAR_CUE = /\b(?:olvida|olvidate|borra|limpia|quita|saca|dejemos\s+sin\s+definir|deja\s+sin\s+definir|resetea)\b/i;
function asksToClearDates(text: string): boolean { return CLEAR_CUE.test(text) && /\b(?:fecha|fechas|entrada|salida|checkin|checkout)\b/i.test(text); }
function asksToClearGuests(text: string): boolean { return CLEAR_CUE.test(text) && /\b(?:personas|huespedes|cantidad|cuantos\s+somos)\b/i.test(text); }
function asksToClearPreferences(text: string): boolean { return /\b(?:sin preferencias|olvida(?:te)?\s+(?:de\s+)?mis\s+preferencias|borra\s+(?:mis\s+)?preferencias|limpia\s+(?:mis\s+)?preferencias)\b/i.test(text); }

function extractGuests(message: string, dateRange: { checkIn: string; checkOut: string } | undefined): number | undefined {
  const text = normalizeText(message);
  const patterns = [
    new RegExp(`\\b(?:somos|seremos|seriamos|vamos\\s+a\\s+ser|viajamos)\\s+(${NUMBER_TOKEN})\\b`, "i"),
    new RegExp(`\\b(${NUMBER_TOKEN})\\s+(?:personas?|huespedes?|pax|adultos?)\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const count = parseCountToken(match?.[1]);
    if (count !== undefined) return count;
  }
  const hasRoomAllocationCue = /\b(?:habitacion|room)\s*(?:nro\.?\s*)?\d+/i.test(text) || /\b(?:la|el)\s+\d{2,4}\s+para\b/i.test(text);
  if (!hasRoomAllocationCue && (dateRange || /\b(?:estadia|alojarnos|quedarnos|hospedarnos)\b/i.test(text))) {
    const match = text.match(new RegExp(`\\bpara\\s+(${NUMBER_TOKEN})\\b`, "i"));
    const count = parseCountToken(match?.[1]);
    if (count !== undefined) return count;
  }
  return undefined;
}

function sanitizePreference(value: string): string | undefined {
  const compact = value.replace(/\s+/g, " ").trim().replace(/[;,]+$/g, "");
  if (!compact || compact.length > 120 || /[{}<>]/.test(compact)) return undefined;
  const normalized = normalizeText(compact);
  if (/\b(?:ignora|ignore|admin|administrador|permiso|permission|role|rol|tool|herramienta|system|sistema|prompt|aprobad|approved|operationtoken|idempotency|tenantid|hotelid|actorid|guestid)\b/i.test(normalized)) return undefined;
  if (!/\b(?:cama|matrimonial|individual|silenc|tranquil|planta\s+baja|piso\s+alto|vista|acces|mascota|fumador|no\s+fumador|cerca|lejos|ascensor)\b/i.test(normalized)) return undefined;
  return compact;
}

function extractPreferences(message: string): string[] {
  const matches = [...message.matchAll(/\b(?:prefiero|preferimos|quisiera|quisieramos|me gustaria|nos gustaria|quiero|queremos)\s+([^.!?]{1,160})/gi)];
  const result: string[] = [];
  for (const match of matches) {
    let candidate = match[1]?.trim() ?? "";
    candidate = candidate.split(/\s+y\s+(?:reservar|cotizar|saber|ver|consultar)\b/i)[0]?.trim() ?? candidate;
    const clean = sanitizePreference(candidate);
    if (clean) result.push(clean);
    if (result.length >= 3) break;
  }
  return result;
}

export function inferConversationIntent(message: string, dateRange?: { checkIn: string; checkOut: string }): ConversationIntent | undefined {
  const text = normalizeText(message);
  if (/\b(?:cancelar|cancela|anular|anula)\b/i.test(text) && /\b(?:reserva|booking)\b/i.test(text)) return "cancellation";
  if (/\b(?:reservar|reserva|confirmar\s+(?:la\s+)?reserva|hacer\s+(?:una\s+)?reserva)\b/i.test(text)) return "reservation";
  if (/\b(?:cotiz|precio|tarifa|cuanto\s+sale|cuanto\s+cuesta)\b/i.test(text)) return "quote";
  if (/\b(?:dispon|hay\s+lugar|tenes\s+lugar|que\s+tenes|que\s+hay|aloj|qued|hosped|estadia|somos|seremos|seriamos)\b/i.test(text)) return "availability";
  if (dateRange && /\b(?:quiero|queremos|necesito|necesitamos|vamos|ir|viajar)\b/i.test(text)) return "availability";
  return undefined;
}

export function extractUserSemanticMemoryUpdate(message: string, current: Readonly<ConversationState>): UserSemanticMemoryUpdate {
  const text = normalizeText(message);
  const update: UserSemanticMemoryUpdate = {};
  const clearDates = asksToClearDates(text);
  const clearGuests = asksToClearGuests(text);
  const dateRange = clearDates ? undefined : extractDateRange(message, current);
  if (clearDates) {
    update.checkIn = null;
    update.checkOut = null;
  } else if (dateRange) {
    update.checkIn = dateRange.checkIn;
    update.checkOut = dateRange.checkOut;
  }
  if (clearGuests) update.guests = null;
  else {
    const guests = extractGuests(message, dateRange);
    if (guests !== undefined) update.guests = guests;
  }
  if (asksToClearPreferences(text)) update.clearPreferences = true;
  else {
    const preferences = extractPreferences(message);
    if (preferences.length) update.preferences = preferences;
  }
  const activeIntent = inferConversationIntent(message, dateRange);
  if (activeIntent) update.activeIntent = activeIntent;
  return update;
}

function semanticUpdatePatch(update: UserSemanticMemoryUpdate): ConversationStatePatch {
  const patch: ConversationStatePatch = {};
  const checkIn = update.checkIn;
  const checkOut = update.checkOut;
  const guests = update.guests;
  if (checkIn === null || typeof checkIn === "string") patch.checkIn = checkIn;
  if (checkOut === null || typeof checkOut === "string") patch.checkOut = checkOut;
  if (guests === null || typeof guests === "number") patch.guests = guests;
  return patch;
}

export function applyUserSemanticTurn(
  current: ConversationState,
  message: string,
  scope: ConversationMemoryScope,
): ConversationState {
  const scoped = bindConversationStateScope(current, scope);
  const update = extractUserSemanticMemoryUpdate(message, scoped);
  return applyConversationStatePatch(scoped, semanticUpdatePatch(update), {
    semanticSource: "user",
    ...(update.preferences ? { preferences: update.preferences } : {}),
    ...(update.clearPreferences ? { clearPreferences: true } : {}),
    ...(update.activeIntent ? { activeIntent: update.activeIntent, activeIntentSource: "user" as const } : {}),
  });
}

/**
 * R2.3: the model may still emit legacy semantic statePatch fields for routing
 * compatibility, but only current-turn server extraction may make dates/guests
 * durable. Keep only grounded room/booking references from model state patches.
 */
export function stripModelSemanticStatePatch(patch: ConversationStatePatch | undefined): ConversationStatePatch | undefined {
  if (!patch) return undefined;
  const safe: ConversationStatePatch = {};
  if (patch.selectedRoomId !== undefined) safe.selectedRoomId = patch.selectedRoomId;
  if (patch.selectedRoomIndex !== undefined) safe.selectedRoomIndex = patch.selectedRoomIndex;
  if (patch.activeBookingId !== undefined) safe.activeBookingId = patch.activeBookingId;
  return Object.keys(safe).length ? safe : undefined;
}

export function conversationIntentForTool(toolId: string): ConversationIntent | undefined {
  if (toolId === "hms.checkAvailability") return "availability";
  if (toolId === "hms.getQuote") return "quote";
  if (toolId === "hms.createReservation") return "reservation";
  if (toolId === "hms.cancelReservation") return "cancellation";
  return undefined;
}

export function enrichPlanInputFromState(toolId: string, input: unknown, state: ConversationState): unknown {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  if (toolId === "hms.checkAvailability") {
    // R2.3 memory is authoritative over conflicting model-proposed semantic args.
    if (state.stay.checkIn) raw.checkIn = state.stay.checkIn;
    if (state.stay.checkOut) raw.checkOut = state.stay.checkOut;
    if (state.stay.guests !== undefined) raw.guests = state.stay.guests;
  }
  if (toolId === "hms.getQuote" || toolId === "hms.createReservation") {
    if (raw.roomId === undefined && state.selectedRoomId) raw.roomId = state.selectedRoomId;
    if (state.stay.checkIn) raw.checkIn = state.stay.checkIn;
    if (state.stay.checkOut) raw.checkOut = state.stay.checkOut;
  }
  if (toolId === "hms.cancelReservation" && raw.bookingId === undefined && state.activeBookingId) raw.bookingId = state.activeBookingId;
  return raw;
}

export function updateConversationStateFromTool(current: ConversationState, toolId: string, input: unknown, data: unknown): ConversationState {
  const rawInput = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const rawData = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const checkIn = stringField(rawInput.checkIn) ?? stringField(rawData.start);
  const checkOut = stringField(rawInput.checkOut) ?? stringField(rawData.end);
  const stayPatch: ConversationStatePatch = {};
  if (validIsoDate(checkIn)) stayPatch.checkIn = checkIn;
  if (validIsoDate(checkOut)) stayPatch.checkOut = checkOut;
  if (validGuests(rawInput.guests)) stayPatch.guests = Number(rawInput.guests);
  const toolIntent = conversationIntentForTool(toolId);
  const semanticOptions: ApplyConversationStateOptions = { semanticSource: "tool" };
  if (toolIntent) {
    semanticOptions.activeIntent = toolIntent;
    semanticOptions.activeIntentSource = "server";
  }
  const next = applyConversationStatePatch(current, stayPatch, semanticOptions);

  if (toolId === "hms.checkAvailability") {
    const rooms = Array.isArray(rawData.rooms) ? rawData.rooms : [];
    next.availabilityRoomIds = rooms.map((room) => room && typeof room === "object" ? stringField((room as Record<string, unknown>).id) : undefined).filter((v): v is string => Boolean(v)).slice(0, 25);
    if (next.selectedRoomId && !next.availabilityRoomIds.includes(next.selectedRoomId)) delete next.selectedRoomId;
  }
  const roomId = stringField(rawInput.roomId) ?? stringField(rawData.roomId);
  if ((toolId === "hms.getQuote" || toolId === "hms.createReservation") && roomId && (next.availabilityRoomIds.length === 0 || next.availabilityRoomIds.includes(roomId))) next.selectedRoomId = roomId;
  const bookingId = stringField(rawData.bookingId);
  if (toolId === "hms.createReservation" && bookingId) next.activeBookingId = bookingId;
  const bookingStatus = stringField(rawData.status);
  if ((toolId === "hms.createReservation" || toolId === "hms.cancelReservation") && bookingStatus) next.bookingStatus = bookingStatus;
  return next;
}
