import type { ValidationResult } from "./types.js";
import type { BookingReference, FieldPatch, OperationIntentPatchValue, RoomReference, TaskGoal } from "./task-state.js";
import type {
  DomainSemanticContract,
  InterpreterAmbiguity,
  InterpreterAmbiguityTopic,
  InterpreterClassification,
  InterpreterDirectives,
  InterpreterInput,
  InterpreterOutput,
  InterpreterReadKind,
  InterpreterRetryTarget,
  InterpreterTaskSemanticChanges,
  TemporalResolutionProvenance,
} from "./semantic-interpreter.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/;
const TOP_LEVEL_KEYS = new Set(["classification", "taskSemanticChanges", "directives", "temporalResolutionProvenance"]);
const CHANGE_KEYS = new Set(["requestedGoal", "checkIn", "checkOut", "guests", "requestedRoomCount", "requestedSelectionReference", "bookingReference", "operationIntent", "preferences", "ambiguity"]);
const DIRECTIVE_KEYS = new Set(["retry", "readRequest", "showOptions", "abortCurrentOperation", "interaction"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
function isNonEmptyString(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}
function dateBefore(left: string, right: string): boolean { return left < right; }

function parsePatch<T>(raw: unknown, parseValue: (value: unknown) => T | undefined): FieldPatch<T> | undefined {
  if (!isRecord(raw) || !exactKeys(raw, new Set(["op", "value"]))) return undefined;
  if (raw.op === "clear") return Object.keys(raw).length === 1 ? { op: "clear" } : undefined;
  if (raw.op !== "set" || !Object.prototype.hasOwnProperty.call(raw, "value")) return undefined;
  const value = parseValue(raw.value);
  return value === undefined ? undefined : { op: "set", value };
}

function parseGoal(value: unknown, contract: DomainSemanticContract): TaskGoal | undefined {
  return contract.allowedGoals.includes(value as TaskGoal) ? value as TaskGoal : undefined;
}
function parsePositiveInteger(value: unknown, max: number): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= max ? Number(value) : undefined;
}
function parseStringList(value: unknown, maxItems = 10): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (!isNonEmptyString(item, 128)) return undefined;
    result.push(item.trim());
  }
  return result;
}

function parseRoomReference(value: unknown): RoomReference | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "room_number" && exactKeys(value, new Set(["kind", "roomNumber", "scope"])) && value.scope === "entity_scoped" && isNonEmptyString(value.roomNumber, 20)) {
    return { kind: "room_number", roomNumber: value.roomNumber.trim(), scope: "entity_scoped" };
  }
  if (value.kind === "ordinal" && exactKeys(value, new Set(["kind", "ordinal", "scope"])) && value.scope === "observation_scoped") {
    const ordinal = parsePositiveInteger(value.ordinal, 25); return ordinal ? { kind: "ordinal", ordinal, scope: "observation_scoped" } : undefined;
  }
  if (value.kind === "ordinal_set" && exactKeys(value, new Set(["kind", "ordinals", "scope"])) && value.scope === "observation_scoped" && Array.isArray(value.ordinals) && value.ordinals.length >= 1 && value.ordinals.length <= 10) {
    const ordinals = value.ordinals.map((item) => parsePositiveInteger(item, 25));
    if (ordinals.some((item) => item === undefined)) return undefined;
    const normalized = ordinals as number[];
    if (new Set(normalized).size !== normalized.length) return undefined;
    return { kind: "ordinal_set", ordinals: normalized, scope: "observation_scoped" };
  }
  if (value.kind === "relation" && exactKeys(value, new Set(["kind", "relation", "scope"])) && value.scope === "observation_scoped" && (value.relation === "other" || value.relation === "both")) {
    return { kind: "relation", relation: value.relation, scope: "observation_scoped" };
  }
  if (value.kind === "descriptive_preference" && exactKeys(value, new Set(["kind", "value", "scope"])) && value.scope === "entity_scoped" && isNonEmptyString(value.value, 100)) {
    return { kind: "descriptive_preference", value: value.value.trim(), scope: "entity_scoped" };
  }
  if (value.kind === "ambiguous" && exactKeys(value, new Set(["kind", "reasonCode", "scope"])) && value.scope === "observation_scoped" && isNonEmptyString(value.reasonCode, 128)) {
    return { kind: "ambiguous", reasonCode: value.reasonCode, scope: "observation_scoped" };
  }
  return undefined;
}

function parseBookingReference(value: unknown): BookingReference | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "explicit_code" && exactKeys(value, new Set(["kind", "code"])) && isNonEmptyString(value.code, 128)) return { kind: "explicit_code", code: value.code.trim() };
  if (value.kind === "ordinal" && exactKeys(value, new Set(["kind", "ordinal"]))) {
    const ordinal = parsePositiveInteger(value.ordinal, 25); return ordinal ? { kind: "ordinal", ordinal } : undefined;
  }
  if (value.kind === "descriptive" && exactKeys(value, new Set(["kind", "value"])) && isNonEmptyString(value.value, 128)) return { kind: "descriptive", value: value.value.trim() };
  if (value.kind === "ambiguous" && exactKeys(value, new Set(["kind", "reasonCode"])) && isNonEmptyString(value.reasonCode, 128)) return { kind: "ambiguous", reasonCode: value.reasonCode };
  return undefined;
}

function parseOperationIntent(value: unknown, contract: DomainSemanticContract): OperationIntentPatchValue | undefined {
  if (!isRecord(value) || !exactKeys(value, new Set(["kind", "status", "targetSemanticReference"]))) return undefined;
  if (!contract.allowedOperationIntents.includes(value.kind as "reserve" | "cancel" | "modify")) return undefined;
  const kind = value.kind as "reserve" | "cancel" | "modify";
  if (value.status !== "active" && value.status !== "ambiguous") return undefined;
  let targetSemanticReference: RoomReference | BookingReference | undefined;
  if (value.targetSemanticReference !== undefined) {
    targetSemanticReference = kind === "reserve" ? parseRoomReference(value.targetSemanticReference) : parseBookingReference(value.targetSemanticReference);
    if (!targetSemanticReference) return undefined;
  }
  return { kind, status: value.status, ...(targetSemanticReference ? { targetSemanticReference } : {}) };
}

function parseAmbiguity(value: unknown): InterpreterAmbiguity | undefined {
  if (!isRecord(value) || !exactKeys(value, new Set(["topic", "reasonCode", "candidateMeaningTypes"]))) return undefined;
  const topics: readonly InterpreterAmbiguityTopic[] = ["dates", "guests", "selection", "booking_reference", "occupancy", "operation_intent", "other"];
  if (!topics.includes(value.topic as InterpreterAmbiguityTopic) || !isNonEmptyString(value.reasonCode, 128)) return undefined;
  let candidateMeaningTypes: readonly string[] | undefined;
  if (value.candidateMeaningTypes !== undefined) {
    candidateMeaningTypes = parseStringList(value.candidateMeaningTypes, 8); if (!candidateMeaningTypes) return undefined;
  }
  return { topic: value.topic as InterpreterAmbiguityTopic, reasonCode: value.reasonCode, ...(candidateMeaningTypes ? { candidateMeaningTypes } : {}) };
}

function parseChanges(value: unknown, contract: DomainSemanticContract): InterpreterTaskSemanticChanges | undefined {
  if (!isRecord(value) || Object.keys(value).length === 0 || !exactKeys(value, CHANGE_KEYS)) return undefined;
  const result: InterpreterTaskSemanticChanges = {};
  const parsers: Record<string, () => unknown> = {
    requestedGoal: () => parsePatch(value.requestedGoal, (item) => parseGoal(item, contract)),
    checkIn: () => parsePatch(value.checkIn, (item) => isIsoDate(item) ? item : undefined),
    checkOut: () => parsePatch(value.checkOut, (item) => isIsoDate(item) ? item : undefined),
    guests: () => parsePatch(value.guests, (item) => parsePositiveInteger(item, 20)),
    requestedRoomCount: () => parsePatch(value.requestedRoomCount, (item) => parsePositiveInteger(item, 10)),
    requestedSelectionReference: () => parsePatch(value.requestedSelectionReference, parseRoomReference),
    bookingReference: () => parsePatch(value.bookingReference, parseBookingReference),
    operationIntent: () => parsePatch(value.operationIntent, (item) => parseOperationIntent(item, contract)),
    preferences: () => parsePatch(value.preferences, (item) => parseStringList(item, 8)),
    ambiguity: () => parseAmbiguity(value.ambiguity),
  };
  for (const key of Object.keys(value)) {
    const parsed = parsers[key]!();
    if (parsed === undefined) return undefined;
    (result as Record<string, unknown>)[key] = parsed;
  }
  return result;
}

function parseDirectives(value: unknown, contract: DomainSemanticContract): InterpreterDirectives | undefined {
  if (!isRecord(value) || Object.keys(value).length === 0 || !exactKeys(value, DIRECTIVE_KEYS)) return undefined;
  const result: InterpreterDirectives = {};
  if (value.retry !== undefined) {
    if (!isRecord(value.retry) || !exactKeys(value.retry, new Set(["target"]))) return undefined;
    const targets: readonly InterpreterRetryTarget[] = ["availability", "quote", "current_operation"];
    if (value.retry.target !== undefined && !targets.includes(value.retry.target as InterpreterRetryTarget)) return undefined;
    result.retry = value.retry.target === undefined ? {} : { target: value.retry.target as InterpreterRetryTarget };
  }
  if (value.readRequest !== undefined) {
    if (!isRecord(value.readRequest) || !exactKeys(value.readRequest, new Set(["kind", "fields"]))) return undefined;
    if (!contract.allowedReadRequests.includes(value.readRequest.kind as InterpreterReadKind)) return undefined;
    let fields: readonly string[] | undefined;
    if (value.readRequest.fields !== undefined) { fields = parseStringList(value.readRequest.fields, 8); if (!fields) return undefined; }
    if (value.readRequest.kind === "knowledge_query" && (!fields || fields.length === 0)) return undefined;
    if (value.readRequest.kind !== "knowledge_query" && fields !== undefined) return undefined;
    result.readRequest = { kind: value.readRequest.kind as InterpreterReadKind, ...(fields ? { fields } : {}) };
  }
  if (value.showOptions !== undefined) { if (value.showOptions !== true) return undefined; result.showOptions = true; }
  if (value.abortCurrentOperation !== undefined) { if (value.abortCurrentOperation !== true) return undefined; result.abortCurrentOperation = true; }
  if (value.interaction !== undefined) {
    if (value.interaction !== "acknowledge" && value.interaction !== "social" && value.interaction !== "help") return undefined;
    result.interaction = value.interaction;
  }
  return result;
}

function parseTemporal(value: unknown, input: Readonly<InterpreterInput>): TemporalResolutionProvenance | undefined {
  if (!isRecord(value) || !exactKeys(value, new Set(["expressionClass", "trustedNow", "timezone", "locale", "normalizedDates", "resolutionPolicyId", "resolutionPolicyVersion"]))) return undefined;
  if (!isNonEmptyString(value.expressionClass, 128) || !isNonEmptyString(value.trustedNow, 64) || !ISO_INSTANT.test(value.trustedNow)) return undefined;
  if (value.trustedNow !== input.temporalContext.trustedNow || value.timezone !== input.temporalContext.timezone || value.locale !== input.temporalContext.locale) return undefined;
  if (value.resolutionPolicyId !== input.temporalContext.calendarPolicyId || value.resolutionPolicyVersion !== input.temporalContext.temporalPolicyVersion) return undefined;
  if (!isRecord(value.normalizedDates) || !exactKeys(value.normalizedDates, new Set(["checkIn", "checkOut"]))) return undefined;
  const normalizedDates: {checkIn?:string;checkOut?:string} = {};
  if (value.normalizedDates.checkIn !== undefined) { if (!isIsoDate(value.normalizedDates.checkIn)) return undefined; normalizedDates.checkIn = value.normalizedDates.checkIn; }
  if (value.normalizedDates.checkOut !== undefined) { if (!isIsoDate(value.normalizedDates.checkOut)) return undefined; normalizedDates.checkOut = value.normalizedDates.checkOut; }
  if (!normalizedDates.checkIn && !normalizedDates.checkOut) return undefined;
  if (normalizedDates.checkIn && normalizedDates.checkOut && !dateBefore(normalizedDates.checkIn, normalizedDates.checkOut)) return undefined;
  return {
    expressionClass: value.expressionClass,
    trustedNow: value.trustedNow,
    timezone: input.temporalContext.timezone,
    locale: input.temporalContext.locale,
    normalizedDates,
    resolutionPolicyId: input.temporalContext.calendarPolicyId,
    resolutionPolicyVersion: input.temporalContext.temporalPolicyVersion,
  };
}

function effectiveDate(patch: FieldPatch<string> | undefined, current: string | undefined): string | undefined {
  if (!patch) return current;
  return patch.op === "clear" ? undefined : patch.value;
}

export function validateInterpreterOutput(raw: unknown, input: Readonly<InterpreterInput>): ValidationResult<InterpreterOutput> {
  if (!isRecord(raw) || !exactKeys(raw, TOP_LEVEL_KEYS)) return { ok: false, message: "Interpreter output shape is invalid" };
  if (raw.classification !== "task" && raw.classification !== "social" && raw.classification !== "help" && raw.classification !== "unknown") {
    return { ok: false, message: "Interpreter classification is invalid" };
  }
  const classification = raw.classification as InterpreterClassification;
  const taskSemanticChanges = raw.taskSemanticChanges === undefined ? undefined : parseChanges(raw.taskSemanticChanges, input.domainSemanticContract);
  if (raw.taskSemanticChanges !== undefined && !taskSemanticChanges) return { ok: false, message: "Semantic changes are invalid" };
  const directives = raw.directives === undefined ? undefined : parseDirectives(raw.directives, input.domainSemanticContract);
  if (raw.directives !== undefined && !directives) return { ok: false, message: "Interpreter directives are invalid" };
  const temporalResolutionProvenance = raw.temporalResolutionProvenance === undefined ? undefined : parseTemporal(raw.temporalResolutionProvenance, input);
  if (raw.temporalResolutionProvenance !== undefined && !temporalResolutionProvenance) return { ok: false, message: "Temporal resolution provenance is invalid" };

  if (classification === "social" || classification === "help") {
    if (taskSemanticChanges || temporalResolutionProvenance || directives?.retry || directives?.readRequest || directives?.showOptions || directives?.abortCurrentOperation) {
      return { ok: false, message: "Non-task classification cannot mutate task semantics" };
    }
    const expected = classification === "social" ? "social" : "help";
    if (directives?.interaction !== expected) return { ok: false, message: "Non-task interaction does not match classification" };
  }
  if (classification === "unknown" && (taskSemanticChanges || directives || temporalResolutionProvenance)) {
    return { ok: false, message: "Unknown classification must not create semantics or directives" };
  }
  if (classification === "task" && !taskSemanticChanges && !directives && !temporalResolutionProvenance) {
    return { ok: false, message: "Task classification contains no interpretable signal" };
  }

  if (taskSemanticChanges) {
    const checkIn = effectiveDate(taskSemanticChanges.checkIn, input.taskContextProjection.requestedStay.checkIn);
    const checkOut = effectiveDate(taskSemanticChanges.checkOut, input.taskContextProjection.requestedStay.checkOut);
    if (checkIn && checkOut && !dateBefore(checkIn, checkOut)) return { ok: false, message: "Semantic date range is invalid" };
  }

  if (temporalResolutionProvenance) {
    const normalized = temporalResolutionProvenance.normalizedDates;
    if (normalized.checkIn && (taskSemanticChanges?.checkIn?.op !== "set" || taskSemanticChanges.checkIn.value !== normalized.checkIn)) {
      return { ok: false, message: "Temporal check-in provenance does not match semantic changes" };
    }
    if (normalized.checkOut && (taskSemanticChanges?.checkOut?.op !== "set" || taskSemanticChanges.checkOut.value !== normalized.checkOut)) {
      return { ok: false, message: "Temporal check-out provenance does not match semantic changes" };
    }
  }

  return {
    ok: true,
    value: {
      classification,
      ...(taskSemanticChanges ? { taskSemanticChanges } : {}),
      ...(directives ? { directives } : {}),
      ...(temporalResolutionProvenance ? { temporalResolutionProvenance } : {}),
    },
  };
}
