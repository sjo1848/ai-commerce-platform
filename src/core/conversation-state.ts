import { CoreError } from "./errors.js";
import type { ConversationStore } from "./conversation.js";

export const CONVERSATION_STATE_TOOL_ID = "__conversation_state";

export type ConversationIntent = "availability" | "quote" | "reservation" | "cancellation";
export type SemanticMemorySource = "user" | "tool" | "server" | "legacy";

export type ConversationMemoryScope = { tenantId: string; actorId: string; sessionId: string };
export type SemanticFactProvenance = { source: SemanticMemorySource; revision: number; cleared?: true };
export type StoredPreference = { value: string; source: "user" | "legacy"; revision: number };
export type SemanticMemory = {
  revision: number;
  scope?: ConversationMemoryScope;
  stay: { checkIn?: SemanticFactProvenance; checkOut?: SemanticFactProvenance; guests?: SemanticFactProvenance };
  preferences: StoredPreference[];
  preferencesClearedAtRevision?: number;
  activeIntent?: { value: ConversationIntent; source: "user" | "server" | "legacy"; revision: number };
};
export type StayState = { checkIn?: string; checkOut?: string; guests?: number };
export type ConversationState = {
  stay: StayState;
  semanticMemory: SemanticMemory;
  availabilityRoomIds: string[];
  selectedRoomId?: string;
  activeBookingId?: string;
  bookingStatus?: string;
  /** Server-owned revision for operational booking grounding; never model-authored. */
  bookingStateRevision?: number;
};
export type ConversationStatePatch = {
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: number | null;
  selectedRoomId?: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validRevision(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validGuests(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20;
}

function validSelectionIndex(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 25;
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validMemorySource(value: unknown): value is SemanticMemorySource {
  return value === "user" || value === "tool" || value === "server" || value === "legacy";
}

function validIntent(value: unknown): value is ConversationIntent {
  return value === "availability" || value === "quote" || value === "reservation" || value === "cancellation";
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function parseProvenance(value: unknown): SemanticFactProvenance | undefined {
  if (!isRecord(value) || !validMemorySource(value.source) || !validRevision(value.revision)) return undefined;
  return {
    source: value.source,
    revision: value.revision,
    ...(value.cleared === true ? { cleared: true as const } : {}),
  };
}

function parseStoredState(value: unknown): ConversationState | undefined {
  if (!isRecord(value)) return undefined;
  const state = emptyConversationState();
  const rawStay = isRecord(value.stay) ? value.stay : {};
  if (validIsoDate(rawStay.checkIn)) state.stay.checkIn = rawStay.checkIn;
  if (validIsoDate(rawStay.checkOut)) state.stay.checkOut = rawStay.checkOut;
  if (validGuests(rawStay.guests)) state.stay.guests = Number(rawStay.guests);

  if (Array.isArray(value.availabilityRoomIds)) {
    state.availabilityRoomIds = value.availabilityRoomIds
      .map(stringField)
      .filter((item): item is string => Boolean(item))
      .slice(0, 25);
  }
  const selectedRoomId = stringField(value.selectedRoomId);
  if (selectedRoomId && state.availabilityRoomIds.includes(selectedRoomId)) state.selectedRoomId = selectedRoomId;
  const activeBookingId = stringField(value.activeBookingId);
  if (activeBookingId) state.activeBookingId = activeBookingId;
  const bookingStatus = stringField(value.bookingStatus);
  if (bookingStatus) state.bookingStatus = bookingStatus;
  if (validRevision(value.bookingStateRevision)) state.bookingStateRevision = value.bookingStateRevision;
  else if (activeBookingId || bookingStatus) state.bookingStateRevision = 0;

  const rawMemory = isRecord(value.semanticMemory) ? value.semanticMemory : {};
  const memory = state.semanticMemory;
  if (validRevision(rawMemory.revision)) memory.revision = rawMemory.revision;
  if (validRevision(rawMemory.preferencesClearedAtRevision)) {
    memory.preferencesClearedAtRevision = rawMemory.preferencesClearedAtRevision;
  }
  if (isRecord(rawMemory.scope)) {
    const tenantId = stringField(rawMemory.scope.tenantId);
    const actorId = stringField(rawMemory.scope.actorId);
    const sessionId = stringField(rawMemory.scope.sessionId);
    if (tenantId && actorId && sessionId) memory.scope = { tenantId, actorId, sessionId };
  }

  const rawMemoryStay = isRecord(rawMemory.stay) ? rawMemory.stay : {};
  for (const field of ["checkIn", "checkOut", "guests"] as const) {
    const meta = parseProvenance(rawMemoryStay[field]);
    const hasValue = field === "guests" ? state.stay.guests !== undefined : state.stay[field] !== undefined;
    if (meta && (hasValue || meta.cleared)) memory.stay[field] = meta;
  }

  if (Array.isArray(rawMemory.preferences)) {
    const seen = new Set<string>();
    for (const item of rawMemory.preferences) {
      if (!isRecord(item)) continue;
      const preference = stringField(item.value);
      const source = item.source === "user" || item.source === "legacy" ? item.source : undefined;
      const revision = validRevision(item.revision) ? item.revision : undefined;
      if (!preference || !source || revision === undefined) continue;
      if (memory.preferencesClearedAtRevision !== undefined && revision <= memory.preferencesClearedAtRevision) continue;
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

  if (state.stay.checkIn && !memory.stay.checkIn) memory.stay.checkIn = { source: "legacy", revision: memory.revision };
  if (state.stay.checkOut && !memory.stay.checkOut) memory.stay.checkOut = { source: "legacy", revision: memory.revision };
  if (state.stay.guests !== undefined && !memory.stay.guests) memory.stay.guests = { source: "legacy", revision: memory.revision };
  return state;
}

function normalizeConversationState(value: ConversationState): ConversationState {
  return parseStoredState(value) ?? emptyConversationState();
}

function sameScope(a?: ConversationMemoryScope, b?: ConversationMemoryScope): boolean {
  return !a || !b || (a.tenantId === b.tenantId && a.actorId === b.actorId && a.sessionId === b.sessionId);
}

function sameStay(a: ConversationState, b: ConversationState): boolean {
  return a.stay.checkIn === b.stay.checkIn && a.stay.checkOut === b.stay.checkOut && a.stay.guests === b.stay.guests;
}

function factValue(state: ConversationState, field: keyof StayState): string | number | undefined {
  return state.stay[field];
}

function putChosenFact(
  target: ConversationState,
  source: ConversationState,
  field: keyof StayState,
  meta: SemanticFactProvenance,
): void {
  target.semanticMemory.stay[field] = structuredClone(meta);
  if (meta.cleared) {
    delete target.stay[field];
    return;
  }
  const value = factValue(source, field);
  if (value === undefined) return;
  if (field === "guests") target.stay.guests = Number(value);
  else target.stay[field] = String(value);
}

function factMarker(state: ConversationState, field: keyof StayState, meta: SemanticFactProvenance): string | number | undefined {
  return meta.cleared ? "__cleared__" : factValue(state, field);
}

function sourceRank(source: SemanticMemorySource): number {
  if (source === "user") return 4;
  if (source === "tool") return 3;
  if (source === "server") return 2;
  return 1;
}

export function mergeConcurrentConversationState(current: ConversationState, incoming: ConversationState): ConversationState {
  const left = normalizeConversationState(current);
  const right = normalizeConversationState(incoming);
  const leftMemory = left.semanticMemory;
  const rightMemory = right.semanticMemory;
  if (!sameScope(leftMemory.scope, rightMemory.scope)) {
    throw new CoreError("FORBIDDEN", "Conversation semantic memory scope mismatch", 403);
  }

  const next = emptyConversationState();
  const scope = rightMemory.scope ?? leftMemory.scope;
  if (scope) next.semanticMemory.scope = structuredClone(scope);

  let trueConcurrentConflict = false;
  for (const field of ["checkIn", "checkOut", "guests"] as const) {
    const leftMeta = leftMemory.stay[field];
    const rightMeta = rightMemory.stay[field];
    if (!leftMeta && !rightMeta) continue;
    if (!rightMeta) {
      putChosenFact(next, left, field, leftMeta!);
      continue;
    }
    if (!leftMeta) {
      putChosenFact(next, right, field, rightMeta);
      continue;
    }
    if (leftMeta.revision > rightMeta.revision) {
      putChosenFact(next, left, field, leftMeta);
      continue;
    }
    if (rightMeta.revision > leftMeta.revision) {
      putChosenFact(next, right, field, rightMeta);
      continue;
    }

    const leftValue = factMarker(left, field, leftMeta);
    const rightValue = factMarker(right, field, rightMeta);
    if (leftValue !== rightValue) {
      if (leftMemory.revision > rightMemory.revision) {
        putChosenFact(next, left, field, leftMeta);
        continue;
      }
      if (rightMemory.revision > leftMemory.revision) {
        putChosenFact(next, right, field, rightMeta);
        continue;
      }
      trueConcurrentConflict = true;
    }

    if (leftValue === rightValue && sourceRank(leftMeta.source) > sourceRank(rightMeta.source)) {
      putChosenFact(next, left, field, leftMeta);
    } else {
      putChosenFact(next, right, field, rightMeta);
    }
  }

  const leftIntent = leftMemory.activeIntent;
  const rightIntent = rightMemory.activeIntent;
  const intentConflict = Boolean(
    leftIntent
    && rightIntent
    && leftIntent.revision === rightIntent.revision
    && leftIntent.value !== rightIntent.value
    && leftMemory.revision === rightMemory.revision
  );
  const concurrentRevision = leftMemory.revision === rightMemory.revision && !sameStay(left, right);
  next.semanticMemory.revision = Math.max(leftMemory.revision, rightMemory.revision)
    + (concurrentRevision || trueConcurrentConflict || intentConflict ? 1 : 0);

  const clearAt = Math.max(
    leftMemory.preferencesClearedAtRevision ?? -1,
    rightMemory.preferencesClearedAtRevision ?? -1,
  );
  if (clearAt >= 0) next.semanticMemory.preferencesClearedAtRevision = clearAt;
  const preferences = new Map<string, StoredPreference>();
  const addPreference = (item: StoredPreference, globalRevision: number, fromRight: boolean) => {
    if (item.revision <= clearAt) return;
    const key = normalizeText(item.value);
    const existing = preferences.get(key);
    if (!existing || item.revision > existing.revision || (item.revision === existing.revision && (globalRevision >= Math.max(leftMemory.revision, rightMemory.revision) || fromRight))) {
      preferences.set(key, structuredClone(item));
    }
  };
  for (const item of leftMemory.preferences) addPreference(item, leftMemory.revision, false);
  for (const item of rightMemory.preferences) addPreference(item, rightMemory.revision, true);
  next.semanticMemory.preferences = [...preferences.values()].sort((a, b) => a.revision - b.revision).slice(-8);

  if (leftIntent && rightIntent) {
    if (leftIntent.revision > rightIntent.revision) next.semanticMemory.activeIntent = structuredClone(leftIntent);
    else if (rightIntent.revision > leftIntent.revision) next.semanticMemory.activeIntent = structuredClone(rightIntent);
    else if (leftMemory.revision > rightMemory.revision) next.semanticMemory.activeIntent = structuredClone(leftIntent);
    else next.semanticMemory.activeIntent = structuredClone(rightIntent);
  } else if (rightIntent) next.semanticMemory.activeIntent = structuredClone(rightIntent);
  else if (leftIntent) next.semanticMemory.activeIntent = structuredClone(leftIntent);

  const groundingCandidates = [left, right]
    .filter((state) => sameStay(next, state))
    .sort((a, b) => a.semanticMemory.revision - b.semanticMemory.revision);
  const grounding = groundingCandidates.at(-1);
  if (grounding) {
    next.availabilityRoomIds = [...grounding.availabilityRoomIds];
    if (grounding.selectedRoomId && next.availabilityRoomIds.includes(grounding.selectedRoomId)) {
      next.selectedRoomId = grounding.selectedRoomId;
    }
  }

  const leftBookingRevision = left.bookingStateRevision ?? (left.activeBookingId || left.bookingStatus ? 0 : -1);
  const rightBookingRevision = right.bookingStateRevision ?? (right.activeBookingId || right.bookingStatus ? 0 : -1);
  const bookingConflict = leftBookingRevision >= 0
    && leftBookingRevision === rightBookingRevision
    && (left.activeBookingId !== right.activeBookingId || left.bookingStatus !== right.bookingStatus);
  let bookingSource = right;
  if (leftBookingRevision > rightBookingRevision) bookingSource = left;
  else if (rightBookingRevision === leftBookingRevision) {
    if (leftMemory.revision > rightMemory.revision) bookingSource = left;
    else if (rightMemory.revision > leftMemory.revision) bookingSource = right;
  }
  const mergedBookingRevision = Math.max(leftBookingRevision, rightBookingRevision)
    + (bookingConflict && leftMemory.revision === rightMemory.revision ? 1 : 0);
  if (mergedBookingRevision >= 0) next.bookingStateRevision = mergedBookingRevision;
  if (bookingSource.activeBookingId) next.activeBookingId = bookingSource.activeBookingId;
  if (bookingSource.bookingStatus) next.bookingStatus = bookingSource.bookingStatus;
  return next;
}

export class InMemoryConversationStateStore implements ConversationStateStore {
  private readonly items = new Map<string, ConversationState>();

  async get(sessionId: string): Promise<ConversationState> {
    const state = this.items.get(sessionId);
    return state ? normalizeConversationState(state) : emptyConversationState();
  }

  async put(sessionId: string, state: ConversationState): Promise<void> {
    const incoming = normalizeConversationState(state);
    const current = this.items.get(sessionId);
    this.items.set(sessionId, structuredClone(current ? mergeConcurrentConversationState(current, incoming) : incoming));
  }
}

export class ConversationBackedStateStore implements ConversationStateStore {
  constructor(private readonly conversation: ConversationStore) {}

  async get(sessionId: string): Promise<ConversationState> {
    const turns = await this.conversation.list(sessionId, 32);
    let state: ConversationState | undefined;
    for (const turn of turns) {
      if (turn.role !== "tool" || turn.toolId !== CONVERSATION_STATE_TOOL_ID) continue;
      let parsed: ConversationState | undefined;
      try {
        parsed = parseStoredState(JSON.parse(turn.content));
      } catch {
        continue;
      }
      if (parsed) state = state ? mergeConcurrentConversationState(state, parsed) : parsed;
    }
    return state ?? emptyConversationState();
  }

  async put(sessionId: string, state: ConversationState): Promise<void> {
    await this.conversation.append(sessionId, {
      role: "tool",
      toolId: CONVERSATION_STATE_TOOL_ID,
      content: JSON.stringify(normalizeConversationState(state)),
    });
  }
}

export function bindConversationStateScope(current: ConversationState, scope: ConversationMemoryScope): ConversationState {
  const next = normalizeConversationState(current);
  const old = next.semanticMemory.scope;
  if (old && (old.tenantId !== scope.tenantId || old.actorId !== scope.actorId || old.sessionId !== scope.sessionId)) {
    throw new CoreError("FORBIDDEN", "Conversation semantic memory scope mismatch", 403);
  }
  next.semanticMemory.scope = { ...scope };
  return next;
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
  const next = normalizeConversationState(current);
  const memory = next.semanticMemory;
  const source = options.semanticSource ?? "legacy";
  const changed = new Set<keyof StayState>();
  const cleared = new Set<keyof StayState>();

  const setDate = (field: "checkIn" | "checkOut", value: string | null | undefined) => {
    if (value === undefined) return;
    const previous = memory.stay[field];
    if (source === "tool" && previous?.source === "user") return;
    if (value === null) {
      if (next.stay[field] !== undefined || !previous?.cleared || previous.source !== source) {
        delete next.stay[field];
        cleared.add(field);
      }
      return;
    }
    if (!validIsoDate(value)) return;
    if (next.stay[field] !== value || previous?.cleared || !previous || (source === "user" && previous.source !== "user")) {
      next.stay[field] = value;
      changed.add(field);
    }
  };

  const setGuests = (value: number | null | undefined) => {
    if (value === undefined) return;
    const previous = memory.stay.guests;
    if (source === "tool" && previous?.source === "user") return;
    if (value === null) {
      if (next.stay.guests !== undefined || !previous?.cleared || previous.source !== source) {
        delete next.stay.guests;
        cleared.add("guests");
      }
      return;
    }
    if (!validGuests(value)) return;
    if (next.stay.guests !== value || previous?.cleared || !previous || (source === "user" && previous.source !== "user")) {
      next.stay.guests = value;
      changed.add("guests");
    }
  };

  setDate("checkIn", patch?.checkIn);
  setDate("checkOut", patch?.checkOut);
  setGuests(patch?.guests);

  if (patch?.selectedRoomId === null || patch?.selectedRoomIndex === null) delete next.selectedRoomId;
  if (validSelectionIndex(patch?.selectedRoomIndex)) {
    const roomId = next.availabilityRoomIds[patch.selectedRoomIndex - 1];
    if (roomId) next.selectedRoomId = roomId;
    else delete next.selectedRoomId;
  } else {
    const roomId = stringField(patch?.selectedRoomId);
    if (roomId && next.availabilityRoomIds.includes(roomId)) next.selectedRoomId = roomId;
  }

  if (patch?.activeBookingId === null) delete next.activeBookingId;
  else {
    const activeBookingId = stringField(patch?.activeBookingId);
    if (activeBookingId && activeBookingId === current.activeBookingId) next.activeBookingId = activeBookingId;
  }

  const cleanPreferences = (options.preferences ?? [])
    .map(sanitizePreference)
    .filter((item): item is string => Boolean(item));
  const preferenceKeys = new Set(memory.preferences.map((item) => normalizeText(item.value)));
  const addedPreferences = cleanPreferences.filter((item) => !preferenceKeys.has(normalizeText(item)));
  const clearPreferences = Boolean(options.clearPreferences && (memory.preferences.length > 0 || memory.preferencesClearedAtRevision === undefined));
  const intentSource = options.activeIntentSource ?? (source === "server" ? "server" : source === "legacy" ? "legacy" : "user");
  const clearIntent = options.activeIntent === null && memory.activeIntent !== undefined;
  const changeIntent = options.activeIntent !== undefined
    && options.activeIntent !== null
    && (memory.activeIntent?.value !== options.activeIntent || memory.activeIntent.source !== intentSource);
  const semanticChanged = changed.size > 0
    || cleared.size > 0
    || clearPreferences
    || addedPreferences.length > 0
    || clearIntent
    || changeIntent;

  if (semanticChanged) {
    const revision = memory.revision + 1;
    memory.revision = revision;
    for (const field of cleared) memory.stay[field] = { source, revision, cleared: true };
    for (const field of changed) memory.stay[field] = { source, revision };
    if (clearPreferences) {
      memory.preferences = [];
      memory.preferencesClearedAtRevision = revision;
    }
    for (const preference of addedPreferences) memory.preferences.push({ value: preference, source: "user", revision });
    if (memory.preferences.length > 8) memory.preferences = memory.preferences.slice(-8);
    if (clearIntent) delete memory.activeIntent;
    if (options.activeIntent !== undefined && options.activeIntent !== null && changeIntent) {
      memory.activeIntent = { value: options.activeIntent, source: intentSource, revision };
    }
  }
  return next;
}

const MONTHS: Readonly<Record<string, number>> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
};
const NUMBER_TOKEN = "(?:\\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte)";

function parseCountToken(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = normalizeText(value);
  const count = /^\d{1,2}$/.test(normalized) ? Number(normalized) : NUMBER_WORDS[normalized];
  return validGuests(count) ? count : undefined;
}

function formatIsoDate(year: number, month: number, day: number): string | undefined {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validIsoDate(value) ? value : undefined;
}

function addUtcDays(iso: string, days: number): string | undefined {
  if (!validIsoDate(iso) || !Number.isInteger(days) || days < 1 || days > 30) return undefined;
  const date = new Date(Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)) + days,
  ));
  return formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function extractDateRange(message: string, current: Readonly<ConversationState>): { checkIn: string; checkOut: string } | undefined {
  const text = normalizeText(message);
  const iso = message.match(/\b\d{4}-\d{2}-\d{2}\b/g)?.filter(validIsoDate) ?? [];
  if (iso.length >= 2) return { checkIn: iso.at(-2)!, checkOut: iso.at(-1)! };

  const slash = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)];
  if (slash.length >= 2) {
    const first = slash.at(-2)!;
    const second = slash.at(-1)!;
    const checkIn = formatIsoDate(Number(first[3]), Number(first[2]), Number(first[1]));
    const checkOut = formatIsoDate(Number(second[3]), Number(second[2]), Number(second[1]));
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }

  const months = Object.keys(MONTHS).join("|");
  const ranges = [...text.matchAll(new RegExp(
    `\\b(?:del|de)?\\s*(\\d{1,2})\\s+(?:al|a)\\s+(\\d{1,2})\\s+de\\s+(${months})\\s+(?:de\\s+)?(\\d{4})\\b`,
    "gi",
  ))];
  const range = ranges.at(-1);
  if (range) {
    const month = MONTHS[range[3]!];
    const checkIn = month ? formatIsoDate(Number(range[4]), month, Number(range[1])) : undefined;
    const checkOut = month ? formatIsoDate(Number(range[4]), month, Number(range[2])) : undefined;
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }

  const starts = [...text.matchAll(new RegExp(
    `\\b(?:a partir del|desde el|desde)\\s+(\\d{1,2})\\s+de\\s+(${months})\\s+(?:de\\s+)?(\\d{4})\\b`,
    "gi",
  ))];
  const nights = [...text.matchAll(new RegExp(`\\b(${NUMBER_TOKEN})\\s+noches?\\b`, "gi"))];
  const start = starts.at(-1);
  const nightCount = parseCountToken(nights.at(-1)?.[1]);
  if (start && nightCount) {
    const month = MONTHS[start[2]!];
    const checkIn = month ? formatIsoDate(Number(start[3]), month, Number(start[1])) : undefined;
    const checkOut = checkIn ? addUtcDays(checkIn, nightCount) : undefined;
    if (checkIn && checkOut) return { checkIn, checkOut };
  }

  const partials = [...text.matchAll(/\b(?:del|de)?\s*(\d{1,2})\s+(?:al|a)\s+(\d{1,2})\b/gi)];
  const partial = partials.at(-1);
  if (
    partial
    && current.stay.checkIn
    && current.stay.checkOut
    && current.stay.checkIn.slice(0, 7) === current.stay.checkOut.slice(0, 7)
  ) {
    const year = Number(current.stay.checkIn.slice(0, 4));
    const month = Number(current.stay.checkIn.slice(5, 7));
    const checkIn = formatIsoDate(year, month, Number(partial[1]));
    const checkOut = formatIsoDate(year, month, Number(partial[2]));
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }
  return undefined;
}

const CLEAR_CUE = /\b(?:olvida(?:te)?|olvides|borra|borres|limpia|limpies|quita|quites|saca|saques|dejemos\s+sin\s+definir|deja\s+sin\s+definir|resetea|resetees)\b/i;

function positiveClearSegments(text: string): string[] {
  const matches = [...text.matchAll(new RegExp(CLEAR_CUE.source, "gi"))];
  const result: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match?.index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const prefix = text.slice(Math.max(0, start - 16), start);
    if (/\bno\s+(?:te\s+)?$/i.test(prefix)) continue;
    result.push(text.slice(start, end));
  }
  return result;
}

function asksToClearDates(text: string): boolean {
  return positiveClearSegments(text).some((segment) => /\b(?:fecha|fechas|entrada|salida|checkin|checkout)\b/i.test(segment));
}

function asksToClearGuests(text: string): boolean {
  return positiveClearSegments(text).some((segment) => /\b(?:personas|huespedes|cantidad|cuantos\s+somos)\b/i.test(segment));
}

function asksToClearPreferences(text: string): boolean {
  if (/\bsin preferencias\b/i.test(text)) return true;
  return positiveClearSegments(text).some((segment) => {
    // A clear cue only owns the preferences target inside its own clause.
    // `borra las fechas y muéstrame mis preferencias` must not erase them,
    // while `borra las fechas y también mis preferencias` still may.
    const ownedClause = segment.split(
      /[;.!?]|\by\s+(?:muestr\w*|mostr\w*|decim\w*|dime|consult\w*|list\w*|quiero|quisiera|prefiero)\b/i,
      1,
    )[0] ?? segment;
    return /\bpreferencias?\b/i.test(ownedClause);
  });
}

function affirmedPartySegment(text: string): string {
  const introductions = [...text.matchAll(/\b(?:somos|seremos|seriamos|vamos\s+a\s+ser|viajamos)\b/gi)];
  if (introductions.length > 1) {
    const latest = introductions.at(-1);
    if (latest?.index !== undefined) return text.slice(latest.index);
  }
  const corrections = [...text.matchAll(/\b(?:mejor|en realidad|perdon|corrijo|correccion)\b/gi)];
  const latestCorrection = corrections.at(-1);
  if (latestCorrection?.index !== undefined) return text.slice(latestCorrection.index);
  return text;
}

function extractGuests(
  message: string,
  dateRange: { checkIn: string; checkOut: string } | undefined,
): number | undefined {
  const text = normalizeText(message);
  const partyText = affirmedPartySegment(text);
  const categories = new Map<string, number>();
  for (const match of partyText.matchAll(new RegExp(
    `\\b(${NUMBER_TOKEN})\\s+(adultos?|adultas?|ninos?|ninas?|menores?|chicos?|chicas?|bebes?)\\b`,
    "gi",
  ))) {
    const count = parseCountToken(match[1]);
    if (count === undefined) continue;
    const rawCategory = match[2] ?? "";
    const category = /adult/.test(rawCategory) ? "adult" : /bebe/.test(rawCategory) ? "infant" : "child";
    categories.set(category, (categories.get(category) ?? 0) + count);
  }
  if (categories.size) {
    const total = [...categories.values()].reduce((sum, count) => sum + count, 0);
    if (validGuests(total)) return total;
  }

  const candidates: Array<{ count: number; index: number }> = [];
  for (const pattern of [
    new RegExp(`\\b(?:somos|seremos|seriamos|vamos\\s+a\\s+ser|viajamos)\\s+(${NUMBER_TOKEN})\\b`, "gi"),
    new RegExp(`\\b(${NUMBER_TOKEN})\\s+(?:personas?|huespedes?|pax)\\b`, "gi"),
  ]) {
    for (const match of partyText.matchAll(pattern)) {
      const count = parseCountToken(match[1]);
      if (count !== undefined) candidates.push({ count, index: match.index ?? 0 });
    }
  }
  candidates.sort((a, b) => a.index - b.index);
  if (candidates.length) return candidates.at(-1)!.count;

  const allocation = /\b(?:habitacion|room)\s*(?:nro\.?\s*)?\d+/i.test(text)
    || /\b(?:la|el)\s+\d{2,4}\s+para\b/i.test(text);
  if (!allocation && (dateRange || /\b(?:estadia|alojarnos|quedarnos|hospedarnos)\b/i.test(text))) {
    const matches = [...partyText.matchAll(new RegExp(`\\bpara\\s+(${NUMBER_TOKEN})\\b`, "gi"))];
    return parseCountToken(matches.at(-1)?.[1]);
  }
  return undefined;
}

const PREFERENCE_TRUSTED_OR_META = /\b(?:admin|administrador|permiso|permission|role|rol|tool|herramienta|system|sistema|prompt|aprobad|approved|operationtoken|idempotency|tenantid|hotelid|actorid|guestid)\b/i;
const PREFERENCE_INSTRUCTION_CONTEXT = /\b(?:a partir de ahora|desde ahora|de ahora en adelante|en adelante|proximo turno|siguiente turno|cada turno|futuros? turnos?)\b/i;
const PREFERENCE_CONTROL_VERB = /\b(?:ignora|ignore|obedece|obedecer|cumple|cumplir|sigue|seguir|selecciona|seleccionar|elige|elegi|escoge|ejecuta|ejecutar|responde|responder|contesta|contestar|actua|actuar|comportate|haz|hace|haceme|recorda|recuerda|debes|tenes que|tienes que|confirma|confirmar|confirmes|reservar|cancela|cancelar|anula|anular|aprueba|aprobar|autoriza|autorizar)\b/i;
const PREFERENCE_INSTRUCTION_OBJECT = /\b(?:orden|ordenes|instruccion|instrucciones|regla|reglas|primera opcion|segunda opcion|tercera opcion)\b/i;
const PREFERENCE_OPERATIONAL_TERM = /\b(?:booking|confirm\w*|cancel\w*|anul\w*|aprob\w*|autoriz\w*|pag\w*|cobr\w*|proces\w*|gestion\w*)\b/i;
const PREFERENCE_RESERVATION_COMMAND = /\breserva\b(?=\s+(?:automaticamente|siempre|todas?|cualquier|la|las|el|los|mi|mis|una|un|primera|segunda|tercera|habitacion|opcion|para)\b)/i;

function sanitizePreference(value: string): string | undefined {
  const compact = value.replace(/\s+/g, " ").trim().replace(/[;,]+$/g, "");
  if (!compact || compact.length > 120 || /[{}<>]/.test(compact)) return undefined;
  const normalized = normalizeText(compact);
  if (PREFERENCE_TRUSTED_OR_META.test(normalized)) return undefined;
  if (PREFERENCE_INSTRUCTION_CONTEXT.test(normalized)) return undefined;
  if (PREFERENCE_CONTROL_VERB.test(normalized)) return undefined;
  if (PREFERENCE_INSTRUCTION_OBJECT.test(normalized)) return undefined;
  if (PREFERENCE_OPERATIONAL_TERM.test(normalized)) return undefined;
  if (PREFERENCE_RESERVATION_COMMAND.test(normalized)) return undefined;
  if (!/\b(?:habitacion|cama|matrimonial|individual|silenc|tranquil|planta\s+baja|piso\s+alto|vista|acces|mascota|fumador|no\s+fumador|cerca|lejos|ascensor)\b/i.test(normalized)) return undefined;
  return compact;
}

function extractPreferences(message: string): string[] {
  const normalized = normalizeText(message);
  const result: string[] = [];
  for (const match of normalized.matchAll(/\b(?:prefiero|preferimos|quisiera|quisieramos|me gustaria|nos gustaria|quiero|queremos)\s+([^.!?]{1,160})/gi)) {
    let candidate = match[1]?.trim() ?? "";
    candidate = candidate.split(/\s+y\s+(?:reservar|cotizar|saber|ver|consultar)\b/i)[0]?.trim() ?? candidate;
    const clean = sanitizePreference(candidate);
    if (clean) result.push(clean);
    if (result.length >= 3) break;
  }
  return result;
}

export function inferConversationIntent(
  message: string,
  dateRange?: { checkIn: string; checkOut: string },
): ConversationIntent | undefined {
  const text = normalizeText(message);
  if (/\b(?:cancelar|cancela|anular|anula)\b/i.test(text) && /\b(?:reserva|booking)\b/i.test(text)) return "cancellation";
  if (/\b(?:reservar|reserva|confirmar\s+(?:la\s+)?reserva|hacer\s+(?:una\s+)?reserva)\b/i.test(text)) return "reservation";
  if (/\b(?:cotiz|precio|tarifa|cuanto\s+sale|cuanto\s+cuesta)\b/i.test(text)) return "quote";
  const party = new RegExp(`\\b(?:somos|seremos|seriamos|vamos\\s+a\\s+ser|viajamos)\\s+${NUMBER_TOKEN}\\b`, "i").test(text)
    || new RegExp(`\\b${NUMBER_TOKEN}\\s+(?:personas?|huespedes?|pax|adultos?|ninos?|menores?)\\b`, "i").test(text);
  if (/\b(?:dispon|hay\s+lugar|tenes\s+lugar|que\s+tenes|que\s+hay|aloj|qued|hosped|estadia)\b/i.test(text) || party) return "availability";
  if (dateRange && /\b(?:quiero|queremos|necesito|necesitamos|vamos|ir|viajar)\b/i.test(text)) return "availability";
  return undefined;
}

export function extractUserSemanticMemoryUpdate(
  message: string,
  current: Readonly<ConversationState>,
): UserSemanticMemoryUpdate {
  const text = normalizeText(message);
  const update: UserSemanticMemoryUpdate = {};
  const clearDates = asksToClearDates(text);
  const clearGuests = asksToClearGuests(text);
  const dates = extractDateRange(message, current);

  if (dates) {
    update.checkIn = dates.checkIn;
    update.checkOut = dates.checkOut;
  } else if (clearDates) {
    update.checkIn = null;
    update.checkOut = null;
  }

  const guests = extractGuests(message, dates);
  if (guests !== undefined) update.guests = guests;
  else if (clearGuests) update.guests = null;

  const preferences = extractPreferences(message);
  if (preferences.length) update.preferences = preferences;
  else if (asksToClearPreferences(text)) update.clearPreferences = true;

  const intent = inferConversationIntent(message, dates);
  if (intent) update.activeIntent = intent;
  return update;
}

function semanticPatch(update: UserSemanticMemoryUpdate): ConversationStatePatch {
  const patch: ConversationStatePatch = {};
  if (update.checkIn === null || typeof update.checkIn === "string") patch.checkIn = update.checkIn;
  if (update.checkOut === null || typeof update.checkOut === "string") patch.checkOut = update.checkOut;
  if (update.guests === null || typeof update.guests === "number") patch.guests = update.guests;
  return patch;
}

export function applyUserSemanticTurn(
  current: ConversationState,
  message: string,
  scope: ConversationMemoryScope,
): ConversationState {
  const scoped = bindConversationStateScope(current, scope);
  const update = extractUserSemanticMemoryUpdate(message, scoped);
  return applyConversationStatePatch(scoped, semanticPatch(update), {
    semanticSource: "user",
    ...(update.preferences ? { preferences: update.preferences } : {}),
    ...(update.clearPreferences ? { clearPreferences: true } : {}),
    ...(update.activeIntent ? { activeIntent: update.activeIntent, activeIntentSource: "user" as const } : {}),
  });
}

export function stripModelSemanticStatePatch(patch: ConversationStatePatch | undefined): ConversationStatePatch | undefined {
  if (!patch) return undefined;
  const safe: ConversationStatePatch = {};
  if (patch.selectedRoomId !== undefined) safe.selectedRoomId = patch.selectedRoomId;
  if (patch.selectedRoomIndex !== undefined) safe.selectedRoomIndex = patch.selectedRoomIndex;
  // Booking grounding is exclusively server/tool-owned. The model may use
  // the current active booking for planning, but cannot mutate or clear it.
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
  const raw = isRecord(input) ? { ...input } : {};
  if (toolId === "hms.checkAvailability") {
    if (state.stay.checkIn) raw.checkIn = state.stay.checkIn;
    if (state.stay.checkOut) raw.checkOut = state.stay.checkOut;
    if (state.stay.guests !== undefined) raw.guests = state.stay.guests;
  }
  if (toolId === "hms.getQuote" || toolId === "hms.createReservation") {
    if (raw.roomId === undefined && state.selectedRoomId) raw.roomId = state.selectedRoomId;
    if (state.stay.checkIn) raw.checkIn = state.stay.checkIn;
    if (state.stay.checkOut) raw.checkOut = state.stay.checkOut;
  }
  if (toolId === "hms.cancelReservation" && raw.bookingId === undefined && state.activeBookingId) {
    raw.bookingId = state.activeBookingId;
  }
  return raw;
}

function userConflict(current: ConversationState, field: keyof StayState, candidate: string | number | undefined): boolean {
  const meta = current.semanticMemory.stay[field];
  if (meta?.source !== "user") return false;
  if (meta.cleared) return candidate !== undefined;
  if (candidate === undefined) return false;
  return factValue(current, field) !== candidate;
}

export function updateConversationStateFromTool(
  current: ConversationState,
  toolId: string,
  input: unknown,
  data: unknown,
): ConversationState {
  const normalized = normalizeConversationState(current);
  const rawInput = isRecord(input) ? input : {};
  const rawData = isRecord(data) ? data : {};
  const checkIn = stringField(rawInput.checkIn) ?? stringField(rawData.start);
  const checkOut = stringField(rawInput.checkOut) ?? stringField(rawData.end);
  const guests = validGuests(rawInput.guests) ? Number(rawInput.guests) : undefined;
  const stale = userConflict(normalized, "checkIn", checkIn)
    || userConflict(normalized, "checkOut", checkOut)
    || userConflict(normalized, "guests", guests);

  const patch: ConversationStatePatch = {};
  if (validIsoDate(checkIn)) patch.checkIn = checkIn;
  if (validIsoDate(checkOut)) patch.checkOut = checkOut;
  if (guests !== undefined) patch.guests = guests;
  const intent = conversationIntentForTool(toolId);
  const next = applyConversationStatePatch(normalized, patch, {
    semanticSource: "tool",
    ...(intent ? { activeIntent: intent, activeIntentSource: "server" as const } : {}),
  });

  if (toolId === "hms.checkAvailability") {
    if (stale) {
      next.availabilityRoomIds = [];
      delete next.selectedRoomId;
    } else {
      const rooms = Array.isArray(rawData.rooms) ? rawData.rooms : [];
      next.availabilityRoomIds = rooms
        .map((room) => isRecord(room) ? stringField(room.id) : undefined)
        .filter((roomId): roomId is string => Boolean(roomId))
        .slice(0, 25);
      if (next.selectedRoomId && !next.availabilityRoomIds.includes(next.selectedRoomId)) delete next.selectedRoomId;
    }
  }

  const roomId = stringField(rawInput.roomId) ?? stringField(rawData.roomId);
  if (
    !stale
    && (toolId === "hms.getQuote" || toolId === "hms.createReservation")
    && roomId
    && (next.availabilityRoomIds.length === 0 || next.availabilityRoomIds.includes(roomId))
  ) {
    next.selectedRoomId = roomId;
  }

  const bookingId = stringField(rawData.bookingId);
  const status = stringField(rawData.status);
  if (toolId === "hms.createReservation" || toolId === "hms.cancelReservation") {
    const resultingBookingId = toolId === "hms.createReservation" && bookingId
      ? bookingId
      : normalized.activeBookingId;
    const resultingStatus = status ?? normalized.bookingStatus;
    const bookingChanged = resultingBookingId !== normalized.activeBookingId
      || resultingStatus !== normalized.bookingStatus;
    if (bookingChanged) next.bookingStateRevision = (normalized.bookingStateRevision ?? 0) + 1;
    else if (normalized.bookingStateRevision !== undefined) next.bookingStateRevision = normalized.bookingStateRevision;
    if (toolId === "hms.createReservation" && bookingId) next.activeBookingId = bookingId;
    if (status) next.bookingStatus = status;
  }
  return next;
}
