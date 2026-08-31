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
};
export type ConversationStatePatch = {
  checkIn?: string | null; checkOut?: string | null; guests?: number | null;
  selectedRoomId?: string | null; selectedRoomIndex?: number | null; activeBookingId?: string | null;
};
export type UserSemanticMemoryUpdate = {
  checkIn?: string | null; checkOut?: string | null; guests?: number | null;
  preferences?: string[]; clearPreferences?: boolean; activeIntent?: ConversationIntent;
};
export interface ConversationStateStore { get(sessionId: string): Promise<ConversationState>; put(sessionId: string, state: ConversationState): Promise<void>; }

function emptySemanticMemory(): SemanticMemory { return { revision: 0, stay: {}, preferences: [] }; }
export function emptyConversationState(): ConversationState { return { stay: {}, semanticMemory: emptySemanticMemory(), availabilityRoomIds: [] }; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function stringField(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function validRevision(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function validGuests(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20; }
function validSelectionIndex(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 25; }
function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const y = Number(value.slice(0, 4)); const m = Number(value.slice(5, 7)); const d = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
function validMemorySource(value: unknown): value is SemanticMemorySource { return value === "user" || value === "tool" || value === "server" || value === "legacy"; }
function validIntent(value: unknown): value is ConversationIntent { return value === "availability" || value === "quote" || value === "reservation" || value === "cancellation"; }
function normalizeText(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
function parseProvenance(value: unknown): SemanticFactProvenance | undefined {
  if (!isRecord(value) || !validMemorySource(value.source) || !validRevision(value.revision)) return undefined;
  return { source: value.source, revision: value.revision, ...(value.cleared === true ? { cleared: true as const } : {}) };
}

function parseStoredState(value: unknown): ConversationState | undefined {
  if (!isRecord(value)) return undefined;
  const state = emptyConversationState(); const rawStay = isRecord(value.stay) ? value.stay : {};
  if (validIsoDate(rawStay.checkIn)) state.stay.checkIn = rawStay.checkIn;
  if (validIsoDate(rawStay.checkOut)) state.stay.checkOut = rawStay.checkOut;
  if (validGuests(rawStay.guests)) state.stay.guests = Number(rawStay.guests);
  if (Array.isArray(value.availabilityRoomIds)) state.availabilityRoomIds = value.availabilityRoomIds.map(stringField).filter((x): x is string => Boolean(x)).slice(0, 25);
  const selected = stringField(value.selectedRoomId); if (selected && state.availabilityRoomIds.includes(selected)) state.selectedRoomId = selected;
  const booking = stringField(value.activeBookingId); if (booking) state.activeBookingId = booking;
  const status = stringField(value.bookingStatus); if (status) state.bookingStatus = status;
  const rawMemory = isRecord(value.semanticMemory) ? value.semanticMemory : {}; const memory = state.semanticMemory;
  if (validRevision(rawMemory.revision)) memory.revision = rawMemory.revision;
  if (validRevision(rawMemory.preferencesClearedAtRevision)) memory.preferencesClearedAtRevision = rawMemory.preferencesClearedAtRevision;
  if (isRecord(rawMemory.scope)) {
    const tenantId = stringField(rawMemory.scope.tenantId); const actorId = stringField(rawMemory.scope.actorId); const sessionId = stringField(rawMemory.scope.sessionId);
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
      if (!isRecord(item)) continue; const pref = stringField(item.value);
      const source = item.source === "user" || item.source === "legacy" ? item.source : undefined;
      const revision = validRevision(item.revision) ? item.revision : undefined;
      if (!pref || !source || revision === undefined) continue;
      if (memory.preferencesClearedAtRevision !== undefined && revision <= memory.preferencesClearedAtRevision) continue;
      const key = normalizeText(pref); if (seen.has(key)) continue; seen.add(key);
      memory.preferences.push({ value: pref.slice(0, 120), source, revision }); if (memory.preferences.length >= 8) break;
    }
  }
  if (isRecord(rawMemory.activeIntent) && validIntent(rawMemory.activeIntent.value) && validRevision(rawMemory.activeIntent.revision)) {
    const source = rawMemory.activeIntent.source;
    if (source === "user" || source === "server" || source === "legacy") memory.activeIntent = { value: rawMemory.activeIntent.value, source, revision: rawMemory.activeIntent.revision };
  }
  if (state.stay.checkIn && !memory.stay.checkIn) memory.stay.checkIn = { source: "legacy", revision: memory.revision };
  if (state.stay.checkOut && !memory.stay.checkOut) memory.stay.checkOut = { source: "legacy", revision: memory.revision };
  if (state.stay.guests !== undefined && !memory.stay.guests) memory.stay.guests = { source: "legacy", revision: memory.revision };
  return state;
}
function normalizeConversationState(value: ConversationState): ConversationState { return parseStoredState(value) ?? emptyConversationState(); }
function sameScope(a?: ConversationMemoryScope, b?: ConversationMemoryScope): boolean { return !a || !b || (a.tenantId === b.tenantId && a.actorId === b.actorId && a.sessionId === b.sessionId); }
function sameStay(a: ConversationState, b: ConversationState): boolean { return a.stay.checkIn === b.stay.checkIn && a.stay.checkOut === b.stay.checkOut && a.stay.guests === b.stay.guests; }
function factValue(state: ConversationState, field: keyof StayState): string | number | undefined { return state.stay[field]; }
function putChosenFact(target: ConversationState, source: ConversationState, field: keyof StayState, meta: SemanticFactProvenance): void {
  target.semanticMemory.stay[field] = structuredClone(meta); if (meta.cleared) { delete target.stay[field]; return; }
  const value = factValue(source, field); if (value === undefined) return;
  if (field === "guests") target.stay.guests = Number(value); else target.stay[field] = String(value);
}

export function mergeConcurrentConversationState(current: ConversationState, incoming: ConversationState): ConversationState {
  const left = normalizeConversationState(current); const right = normalizeConversationState(incoming);
  const lm = left.semanticMemory; const rm = right.semanticMemory;
  if (!sameScope(lm.scope, rm.scope)) throw new CoreError("FORBIDDEN", "Conversation semantic memory scope mismatch", 403);
  const next = emptyConversationState(); const scope = rm.scope ?? lm.scope; if (scope) next.semanticMemory.scope = structuredClone(scope);
  let sameFieldConflict = false;
  for (const field of ["checkIn", "checkOut", "guests"] as const) {
    const l = lm.stay[field]; const r = rm.stay[field]; if (!l && !r) continue;
    if (!r || (l && l.revision > r.revision)) { putChosenFact(next, left, field, l!); continue; }
    if (l && l.revision === r.revision) {
      const lv = l.cleared ? "__cleared__" : factValue(left, field); const rv = r.cleared ? "__cleared__" : factValue(right, field);
      if (lv !== rv) sameFieldConflict = true;
    }
    putChosenFact(next, right, field, r);
  }
  const concurrentRevision = lm.revision === rm.revision && !sameStay(left, right);
  next.semanticMemory.revision = Math.max(lm.revision, rm.revision) + (concurrentRevision || sameFieldConflict ? 1 : 0);
  const clearAt = Math.max(lm.preferencesClearedAtRevision ?? -1, rm.preferencesClearedAtRevision ?? -1); if (clearAt >= 0) next.semanticMemory.preferencesClearedAtRevision = clearAt;
  const prefs = new Map<string, StoredPreference>();
  for (const item of [...lm.preferences, ...rm.preferences]) { if (item.revision <= clearAt) continue; const k = normalizeText(item.value); const old = prefs.get(k); if (!old || item.revision >= old.revision) prefs.set(k, structuredClone(item)); }
  next.semanticMemory.preferences = [...prefs.values()].sort((a, b) => a.revision - b.revision).slice(-8);
  const li = lm.activeIntent; const ri = rm.activeIntent; if (ri && (!li || ri.revision >= li.revision)) next.semanticMemory.activeIntent = structuredClone(ri); else if (li) next.semanticMemory.activeIntent = structuredClone(li);
  const equalsRight = sameStay(next, right); const equalsLeft = sameStay(next, left);
  if (equalsRight && !concurrentRevision && !sameFieldConflict) { next.availabilityRoomIds = [...right.availabilityRoomIds]; if (right.selectedRoomId && next.availabilityRoomIds.includes(right.selectedRoomId)) next.selectedRoomId = right.selectedRoomId; }
  else if (equalsLeft) { next.availabilityRoomIds = [...left.availabilityRoomIds]; if (left.selectedRoomId && next.availabilityRoomIds.includes(left.selectedRoomId)) next.selectedRoomId = left.selectedRoomId; }
  const bookingId = right.activeBookingId ?? left.activeBookingId; if (bookingId) next.activeBookingId = bookingId;
  if (right.activeBookingId && right.bookingStatus) next.bookingStatus = right.bookingStatus; else if (left.bookingStatus) next.bookingStatus = left.bookingStatus;
  return next;
}

export class InMemoryConversationStateStore implements ConversationStateStore {
  private readonly items = new Map<string, ConversationState>();
  async get(sessionId: string): Promise<ConversationState> { const x = this.items.get(sessionId); return x ? normalizeConversationState(x) : emptyConversationState(); }
  async put(sessionId: string, state: ConversationState): Promise<void> { const incoming = normalizeConversationState(state); const current = this.items.get(sessionId); this.items.set(sessionId, structuredClone(current ? mergeConcurrentConversationState(current, incoming) : incoming)); }
}
export class ConversationBackedStateStore implements ConversationStateStore {
  constructor(private readonly conversation: ConversationStore) {}
  async get(sessionId: string): Promise<ConversationState> {
    const turns = await this.conversation.list(sessionId, 32); let state: ConversationState | undefined;
    for (const turn of turns) { if (turn.role !== "tool" || turn.toolId !== CONVERSATION_STATE_TOOL_ID) continue; try { const parsed = parseStoredState(JSON.parse(turn.content)); if (parsed) state = state ? mergeConcurrentConversationState(state, parsed) : parsed; } catch {} }
    return state ?? emptyConversationState();
  }
  async put(sessionId: string, state: ConversationState): Promise<void> { await this.conversation.append(sessionId, { role: "tool", toolId: CONVERSATION_STATE_TOOL_ID, content: JSON.stringify(normalizeConversationState(state)) }); }
}
export function bindConversationStateScope(current: ConversationState, scope: ConversationMemoryScope): ConversationState {
  const next = normalizeConversationState(current); const old = next.semanticMemory.scope;
  if (old && (old.tenantId !== scope.tenantId || old.actorId !== scope.actorId || old.sessionId !== scope.sessionId)) throw new CoreError("FORBIDDEN", "Conversation semantic memory scope mismatch", 403);
  next.semanticMemory.scope = { ...scope }; return next;
}
export type ApplyConversationStateOptions = { semanticSource?: SemanticMemorySource; preferences?: readonly string[]; clearPreferences?: boolean; activeIntent?: ConversationIntent | null; activeIntentSource?: "user" | "server" | "legacy" };
export function applyConversationStatePatch(current: ConversationState, patch: ConversationStatePatch | undefined, options: ApplyConversationStateOptions = {}): ConversationState {
  const next = normalizeConversationState(current); const memory = next.semanticMemory; const source = options.semanticSource ?? "legacy"; const changed = new Set<keyof StayState>(); const cleared = new Set<keyof StayState>();
  const setDate = (field: "checkIn" | "checkOut", value: string | null | undefined) => {
    if (value === undefined) return; const previous = memory.stay[field]; if (source === "tool" && previous?.source === "user") return;
    if (value === null) { if (next.stay[field] !== undefined || !previous?.cleared || previous.source !== source) { delete next.stay[field]; cleared.add(field); } return; }
    if (!validIsoDate(value)) return; if (next.stay[field] !== value || previous?.cleared || !previous || (source === "user" && previous.source !== "user")) { next.stay[field] = value; changed.add(field); }
  };
  const setGuests = (value: number | null | undefined) => {
    if (value === undefined) return; const previous = memory.stay.guests; if (source === "tool" && previous?.source === "user") return;
    if (value === null) { if (next.stay.guests !== undefined || !previous?.cleared || previous.source !== source) { delete next.stay.guests; cleared.add("guests"); } return; }
    if (!validGuests(value)) return; if (next.stay.guests !== value || previous?.cleared || !previous || (source === "user" && previous.source !== "user")) { next.stay.guests = value; changed.add("guests"); }
  };
  setDate("checkIn", patch?.checkIn); setDate("checkOut", patch?.checkOut); setGuests(patch?.guests);
  if (patch?.selectedRoomId === null || patch?.selectedRoomIndex === null) delete next.selectedRoomId;
  if (validSelectionIndex(patch?.selectedRoomIndex)) { const room = next.availabilityRoomIds[patch!.selectedRoomIndex! - 1]; if (room) next.selectedRoomId = room; else delete next.selectedRoomId; }
  else { const room = stringField(patch?.selectedRoomId); if (room && next.availabilityRoomIds.includes(room)) next.selectedRoomId = room; }
  if (patch?.activeBookingId === null) delete next.activeBookingId; else { const id = stringField(patch?.activeBookingId); if (id && id === current.activeBookingId) next.activeBookingId = id; }
  const clean = (options.preferences ?? []).map(sanitizePreference).filter((x): x is string => Boolean(x)); const keys = new Set(memory.preferences.map((x) => normalizeText(x.value))); const added = clean.filter((x) => !keys.has(normalizeText(x)));
  const clearPrefs = Boolean(options.clearPreferences && (memory.preferences.length > 0 || memory.preferencesClearedAtRevision === undefined)); const intentSource = options.activeIntentSource ?? (source === "server" ? "server" : source === "legacy" ? "legacy" : "user");
  const clearIntent = options.activeIntent === null && memory.activeIntent !== undefined; const changeIntent = options.activeIntent !== undefined && options.activeIntent !== null && (memory.activeIntent?.value !== options.activeIntent || memory.activeIntent.source !== intentSource);
  const semanticChanged = changed.size > 0 || cleared.size > 0 || clearPrefs || added.length > 0 || clearIntent || changeIntent;
  if (semanticChanged) { const revision = memory.revision + 1; memory.revision = revision; for (const f of cleared) memory.stay[f] = { source, revision, cleared: true }; for (const f of changed) memory.stay[f] = { source, revision }; if (clearPrefs) { memory.preferences = []; memory.preferencesClearedAtRevision = revision; } for (const p of added) memory.preferences.push({ value: p, source: "user", revision }); if (memory.preferences.length > 8) memory.preferences = memory.preferences.slice(-8); if (clearIntent) delete memory.activeIntent; if (options.activeIntent !== undefined && options.activeIntent !== null && changeIntent) memory.activeIntent = { value: options.activeIntent, source: intentSource, revision }; }
  return next;
}

const MONTHS: Readonly<Record<string, number>> = { enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12 };
const NUMBER_WORDS: Readonly<Record<string, number>> = { un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20 };
const NUMBER_TOKEN = "(?:\\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte)";
function parseCountToken(value?: string): number | undefined { if (!value) return undefined; const n = normalizeText(value); const count = /^\d{1,2}$/.test(n) ? Number(n) : NUMBER_WORDS[n]; return validGuests(count) ? count : undefined; }
function formatIsoDate(y:number,m:number,d:number): string | undefined { const v=`${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; return validIsoDate(v)?v:undefined; }
function addUtcDays(iso:string, days:number): string | undefined { if (!validIsoDate(iso)||!Number.isInteger(days)||days<1||days>30) return undefined; const dt=new Date(Date.UTC(Number(iso.slice(0,4)),Number(iso.slice(5,7))-1,Number(iso.slice(8,10))+days)); return formatIsoDate(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate()); }
function extractDateRange(message:string,current:Readonly<ConversationState>): {checkIn:string;checkOut:string}|undefined {
  const text=normalizeText(message); const iso=message.match(/\b\d{4}-\d{2}-\d{2}\b/g)?.filter(validIsoDate)??[]; if(iso.length>=2)return{checkIn:iso.at(-2)!,checkOut:iso.at(-1)!};
  const slash=[...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)]; if(slash.length>=2){const a=slash.at(-2)!,b=slash.at(-1)!;const ci=formatIsoDate(Number(a[3]),Number(a[2]),Number(a[1])),co=formatIsoDate(Number(b[3]),Number(b[2]),Number(b[1]));if(ci&&co&&co>ci)return{checkIn:ci,checkOut:co};}
  const months=Object.keys(MONTHS).join("|"); const ranges=[...text.matchAll(new RegExp(`\\b(?:del|de)?\\s*(\\d{1,2})\\s+(?:al|a)\\s+(\\d{1,2})\\s+de\\s+(${months})\\s+(?:de\\s+)?(\\d{4})\\b`,"gi"))]; const r=ranges.at(-1); if(r){const m=MONTHS[r[3]!];const ci=m?formatIsoDate(Number(r[4]),m,Number(r[1])):undefined,co=m?formatIsoDate(Number(r[4]),m,Number(r[2])):undefined;if(ci&&co&&co>ci)return{checkIn:ci,checkOut:co};}
  const starts=[...text.matchAll(new RegExp(`\\b(?:a partir del|desde el|desde)\\s+(\\d{1,2})\\s+de\\s+(${months})\\s+(?:de\\s+)?(\\d{4})\\b`,"gi"))]; const nights=[...text.matchAll(new RegExp(`\\b(${NUMBER_TOKEN})\\s+noches?\\b`,"gi"))]; const s=starts.at(-1),count=parseCountToken(nights.at(-1)?.[1]); if(s&&count){const m=MONTHS[s[2]!];const ci=m?formatIsoDate(Number(s[3]),m,Number(s[1])):undefined,co=ci?addUtcDays(ci,count):undefined;if(ci&&co)return{checkIn:ci,checkOut:co};}
  const partials=[...text.matchAll(/\b(?:del|de)?\s*(\d{1,2})\s+(?:al|a)\s+(\d{1,2})\b/gi)];const p=partials.at(-1);if(p&&current.stay.checkIn&&current.stay.checkOut&&current.stay.checkIn.slice(0,7)===current.stay.checkOut.slice(0,7)){const y=Number(current.stay.checkIn.slice(0,4)),m=Number(current.stay.checkIn.slice(5,7));const ci=formatIsoDate(y,m,Number(p[1])),co=formatIsoDate(y,m,Number(p[2]));if(ci&&co&&co>ci)return{checkIn:ci,checkOut:co};} return undefined;
}
const CLEAR_CUE=/\b(?:olvida(?:te)?|olvides|borra|borres|limpia|limpies|quita|quites|saca|saques|dejemos\s+sin\s+definir|deja\s+sin\s+definir|resetea|resetees)\b/i; const NEGATED_CLEAR=/\bno\s+(?:te\s+)?(?:olvides|borres|limpies|quites|saques|resetees)\b/i;
function positiveClear(t:string){return CLEAR_CUE.test(t)&&!NEGATED_CLEAR.test(t)} function asksToClearDates(t:string){return positiveClear(t)&&/\b(?:fecha|fechas|entrada|salida|checkin|checkout)\b/i.test(t)} function asksToClearGuests(t:string){return positiveClear(t)&&/\b(?:personas|huespedes|cantidad|cuantos\s+somos)\b/i.test(t)} function asksToClearPreferences(t:string){return !NEGATED_CLEAR.test(t)&&/\b(?:sin preferencias|olvida(?:te)?\s+(?:de\s+)?mis\s+preferencias|borra\s+(?:mis\s+)?preferencias|limpia\s+(?:mis\s+)?preferencias)\b/i.test(t)}
function extractGuests(message:string,dateRange:{checkIn:string;checkOut:string}|undefined):number|undefined{const text=normalizeText(message);const cats=new Map<string,number>();for(const m of text.matchAll(new RegExp(`\\b(${NUMBER_TOKEN})\\s+(adultos?|adultas?|ninos?|ninas?|menores?|chicos?|chicas?|bebes?)\\b`,"gi"))){const c=parseCountToken(m[1]);if(c===undefined)continue;const raw=m[2]??"";cats.set(/adult/.test(raw)?"adult":/bebe/.test(raw)?"infant":"child",c)}if(cats.size){const total=[...cats.values()].reduce((a,b)=>a+b,0);if(validGuests(total))return total}const candidates:Array<{count:number;index:number}>=[];for(const pattern of[new RegExp(`\\b(?:somos|seremos|seriamos|vamos\\s+a\\s+ser|viajamos)\\s+(${NUMBER_TOKEN})\\b`,"gi"),new RegExp(`\\b(${NUMBER_TOKEN})\\s+(?:personas?|huespedes?|pax)\\b`,"gi")])for(const m of text.matchAll(pattern)){const c=parseCountToken(m[1]);if(c!==undefined)candidates.push({count:c,index:m.index??0})}candidates.sort((a,b)=>a.index-b.index);if(candidates.length)return candidates.at(-1)!.count;const allocation=/\b(?:habitacion|room)\s*(?:nro\.?\s*)?\d+/i.test(text)||/\b(?:la|el)\s+\d{2,4}\s+para\b/i.test(text);if(!allocation&&(dateRange||/\b(?:estadia|alojarnos|quedarnos|hospedarnos)\b/i.test(text))){const ms=[...text.matchAll(new RegExp(`\\bpara\\s+(${NUMBER_TOKEN})\\b`,"gi"))];return parseCountToken(ms.at(-1)?.[1])}return undefined}
function sanitizePreference(value:string):string|undefined{const compact=value.replace(/\s+/g," ").trim().replace(/[;,]+$/g,"");if(!compact||compact.length>120||/[{}<>]/.test(compact))return undefined;const n=normalizeText(compact);if(/\b(?:ignora|ignore|admin|administrador|permiso|permission|role|rol|tool|herramienta|system|sistema|prompt|aprobad|approved|operationtoken|idempotency|tenantid|hotelid|actorid|guestid)\b/i.test(n))return undefined;if(/\b(?:a partir de ahora|desde ahora|siempre|automaticamente|selecciona|seleccionar|elige|elegi|escoge|ejecuta|ejecutar|responde|responder|recorda|recuerda|debes|tenes que|tienes que|primera opcion|segunda opcion|tercera opcion)\b/i.test(n))return undefined;if(!/\b(?:habitacion|cama|matrimonial|individual|silenc|tranquil|planta\s+baja|piso\s+alto|vista|acces|mascota|fumador|no\s+fumador|cerca|lejos|ascensor)\b/i.test(n))return undefined;return compact}
function extractPreferences(message:string):string[]{const n=normalizeText(message),result:string[]=[];for(const m of n.matchAll(/\b(?:prefiero|preferimos|quisiera|quisieramos|me gustaria|nos gustaria|quiero|queremos)\s+([^.!?]{1,160})/gi)){let c=m[1]?.trim()??"";c=c.split(/\s+y\s+(?:reservar|cotizar|saber|ver|consultar)\b/i)[0]?.trim()??c;const clean=sanitizePreference(c);if(clean)result.push(clean);if(result.length>=3)break}return result}
export function inferConversationIntent(message:string,dateRange?:{checkIn:string;checkOut:string}):ConversationIntent|undefined{const t=normalizeText(message);if(/\b(?:cancelar|cancela|anular|anula)\b/i.test(t)&&/\b(?:reserva|booking)\b/i.test(t))return"cancellation";if(/\b(?:reservar|reserva|confirmar\s+(?:la\s+)?reserva|hacer\s+(?:una\s+)?reserva)\b/i.test(t))return"reservation";if(/\b(?:cotiz|precio|tarifa|cuanto\s+sale|cuanto\s+cuesta)\b/i.test(t))return"quote";const party=new RegExp(`\\b(?:somos|seremos|seriamos|vamos\\s+a\\s+ser|viajamos)\\s+${NUMBER_TOKEN}\\b`,"i").test(t)||new RegExp(`\\b${NUMBER_TOKEN}\\s+(?:personas?|huespedes?|pax|adultos?|ninos?|menores?)\\b`,"i").test(t);if(/\b(?:dispon|hay\s+lugar|tenes\s+lugar|que\s+tenes|que\s+hay|aloj|qued|hosped|estadia)\b/i.test(t)||party)return"availability";if(dateRange&&/\b(?:quiero|queremos|necesito|necesitamos|vamos|ir|viajar)\b/i.test(t))return"availability";return undefined}
export function extractUserSemanticMemoryUpdate(message:string,current:Readonly<ConversationState>):UserSemanticMemoryUpdate{const t=normalizeText(message),u:UserSemanticMemoryUpdate={};const clearDates=asksToClearDates(t),clearGuests=asksToClearGuests(t),dates=clearDates?undefined:extractDateRange(message,current);if(clearDates){u.checkIn=null;u.checkOut=null}else if(dates){u.checkIn=dates.checkIn;u.checkOut=dates.checkOut}if(clearGuests)u.guests=null;else{const g=extractGuests(message,dates);if(g!==undefined)u.guests=g}if(asksToClearPreferences(t))u.clearPreferences=true;else{const p=extractPreferences(message);if(p.length)u.preferences=p}const intent=inferConversationIntent(message,dates);if(intent)u.activeIntent=intent;return u}
function semanticPatch(u:UserSemanticMemoryUpdate):ConversationStatePatch{const p:ConversationStatePatch={};if(u.checkIn===null||typeof u.checkIn==="string")p.checkIn=u.checkIn;if(u.checkOut===null||typeof u.checkOut==="string")p.checkOut=u.checkOut;if(u.guests===null||typeof u.guests==="number")p.guests=u.guests;return p}
export function applyUserSemanticTurn(current:ConversationState,message:string,scope:ConversationMemoryScope):ConversationState{const scoped=bindConversationStateScope(current,scope),u=extractUserSemanticMemoryUpdate(message,scoped);return applyConversationStatePatch(scoped,semanticPatch(u),{semanticSource:"user",...(u.preferences?{preferences:u.preferences}:{}),...(u.clearPreferences?{clearPreferences:true}:{}),...(u.activeIntent?{activeIntent:u.activeIntent,activeIntentSource:"user" as const}:{})})}
export function stripModelSemanticStatePatch(patch:ConversationStatePatch|undefined):ConversationStatePatch|undefined{if(!patch)return undefined;const s:ConversationStatePatch={};if(patch.selectedRoomId!==undefined)s.selectedRoomId=patch.selectedRoomId;if(patch.selectedRoomIndex!==undefined)s.selectedRoomIndex=patch.selectedRoomIndex;if(patch.activeBookingId!==undefined)s.activeBookingId=patch.activeBookingId;return Object.keys(s).length?s:undefined}
export function conversationIntentForTool(toolId:string):ConversationIntent|undefined{if(toolId==="hms.checkAvailability")return"availability";if(toolId==="hms.getQuote")return"quote";if(toolId==="hms.createReservation")return"reservation";if(toolId==="hms.cancelReservation")return"cancellation";return undefined}
export function enrichPlanInputFromState(toolId:string,input:unknown,state:ConversationState):unknown{const raw=isRecord(input)?{...input}:{};if(toolId==="hms.checkAvailability"){if(state.stay.checkIn)raw.checkIn=state.stay.checkIn;if(state.stay.checkOut)raw.checkOut=state.stay.checkOut;if(state.stay.guests!==undefined)raw.guests=state.stay.guests}if(toolId==="hms.getQuote"||toolId==="hms.createReservation"){if(raw.roomId===undefined&&state.selectedRoomId)raw.roomId=state.selectedRoomId;if(state.stay.checkIn)raw.checkIn=state.stay.checkIn;if(state.stay.checkOut)raw.checkOut=state.stay.checkOut}if(toolId==="hms.cancelReservation"&&raw.bookingId===undefined&&state.activeBookingId)raw.bookingId=state.activeBookingId;return raw}
function userConflict(current:ConversationState,field:keyof StayState,candidate:string|number|undefined):boolean{const meta=current.semanticMemory.stay[field];if(meta?.source!=="user")return false;if(meta.cleared)return candidate!==undefined;if(candidate===undefined)return false;return factValue(current,field)!==candidate}
export function updateConversationStateFromTool(current:ConversationState,toolId:string,input:unknown,data:unknown):ConversationState{const normalized=normalizeConversationState(current),ri=isRecord(input)?input:{},rd=isRecord(data)?data:{};const checkIn=stringField(ri.checkIn)??stringField(rd.start),checkOut=stringField(ri.checkOut)??stringField(rd.end),guests=validGuests(ri.guests)?Number(ri.guests):undefined;const stale=userConflict(normalized,"checkIn",checkIn)||userConflict(normalized,"checkOut",checkOut)||userConflict(normalized,"guests",guests);const p:ConversationStatePatch={};if(validIsoDate(checkIn))p.checkIn=checkIn;if(validIsoDate(checkOut))p.checkOut=checkOut;if(guests!==undefined)p.guests=guests;const intent=conversationIntentForTool(toolId);const next=applyConversationStatePatch(normalized,p,{semanticSource:"tool",...(intent?{activeIntent:intent,activeIntentSource:"server" as const}:{})});if(toolId==="hms.checkAvailability"){if(stale){next.availabilityRoomIds=[];delete next.selectedRoomId}else{const rooms=Array.isArray(rd.rooms)?rd.rooms:[];next.availabilityRoomIds=rooms.map(r=>isRecord(r)?stringField(r.id):undefined).filter((x):x is string=>Boolean(x)).slice(0,25);if(next.selectedRoomId&&!next.availabilityRoomIds.includes(next.selectedRoomId))delete next.selectedRoomId}}const roomId=stringField(ri.roomId)??stringField(rd.roomId);if(!stale&&(toolId==="hms.getQuote"||toolId==="hms.createReservation")&&roomId&&(next.availabilityRoomIds.length===0||next.availabilityRoomIds.includes(roomId)))next.selectedRoomId=roomId;const bookingId=stringField(rd.bookingId);if(toolId==="hms.createReservation"&&bookingId)next.activeBookingId=bookingId;const status=stringField(rd.status);if((toolId==="hms.createReservation"||toolId==="hms.cancelReservation")&&status)next.bookingStatus=status;return next}
