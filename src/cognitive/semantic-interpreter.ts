import type {
  BookingReference,
  OperationIntent,
  PlanningTrigger,
  RequestedGoal,
  RequestedOccupancy,
  RoomReference,
  TaskLifecycle,
  TaskState,
  UserAmbiguity,
} from "./contracts.js";
import type { UserSemanticEvent, UserSemanticPatch } from "./events.js";

export type InterpreterClassification = "task" | "social" | "help" | "unknown";
export type InterpreterReadKind =
  | "availability"
  | "quote"
  | "compare_price"
  | "show_options"
  | "booking_lookup"
  | "knowledge_query";
export type InterpreterReadTarget = "current_selection" | "presented_set" | "hotel" | "booking";
export type InterpreterRetryTarget = "availability" | "quote" | "reservation" | "cancellation" | "modification";

export type TemporalResolutionProvenance = {
  expressionClass: "relative" | "day_month" | "month_name" | "yearless_range" | "explicit_date";
  trustedNow: string;
  timezone: string;
  policyId: string;
  normalized: { checkIn?: string; checkOut?: string };
};

export type InterpreterDirectives = {
  retry?: { targetOperation?: InterpreterRetryTarget };
  readRequest?: { kind: InterpreterReadKind; target?: InterpreterReadTarget };
  showOptions?: boolean;
  abortCurrentOperation?: boolean;
  interaction?: "acknowledge" | "social" | "help";
};

export type InterpreterOutput = {
  classification: InterpreterClassification;
  taskSemanticChanges?: UserSemanticPatch;
  directives?: InterpreterDirectives;
  temporalResolutionProvenance?: TemporalResolutionProvenance;
};

export type InterpreterTaskContextProjection = {
  lifecycle: TaskLifecycle;
  requestedGoal?: RequestedGoal;
  stay: { checkIn?: string; checkOut?: string; guests?: number };
  requestedRoomCount?: number;
  operationIntent?: OperationIntent;
  hasGroundedSelection: boolean;
  groundedSelectionCount: number;
  hasGroundedBookingTarget: boolean;
  pendingOperation?: { operationType: OperationIntent; status: "prepared" | "approval_required" | "approved" | "invalidated" };
  retryableFailureCount: number;
};

export type InterpreterPresentedEntity = {
  handle: string;
  kind: "room" | "booking" | "hotel";
  label: string;
  ordinal: number;
};

export type InterpreterPresentationContext = {
  entities: readonly InterpreterPresentedEntity[];
  focusedHandle?: string;
};

export type InterpreterDialogueAnchorProjection = {
  kind: "dates" | "check_out" | "guests" | "selection" | "occupancy" | "booking_reference" | "confirmation" | "other_bounded";
  hasPresentedSet: boolean;
  hasFocusedEntity: boolean;
};

export type InterpreterTemporalContext = {
  trustedNow: string;
  timezone: string;
  locale: string;
  temporalPolicyId: string;
};

export type InterpreterDomainSemanticContract = {
  contractId: "hotel_semantics_v1@1";
  goals: readonly RequestedGoal[];
  operationIntents: readonly OperationIntent[];
  readKinds: readonly InterpreterReadKind[];
  contextualReferenceRoles: readonly ("focused_entity" | "current_selection" | "presented_set")[];
};

export type TrustedInterpreterInput = {
  currentUserMessage: string;
  taskContext: InterpreterTaskContextProjection;
  presentationContext?: InterpreterPresentationContext;
  dialogueAnchor?: InterpreterDialogueAnchorProjection;
  temporalContext: InterpreterTemporalContext;
  domainSemanticContract: InterpreterDomainSemanticContract;
};

export type PresentedEntityInput = { kind: "room" | "booking" | "hotel"; label: string };

export function buildTrustedInterpreterInput(args: {
  currentUserMessage: string;
  state: Readonly<TaskState>;
  temporalContext: InterpreterTemporalContext;
  presentedEntities?: readonly PresentedEntityInput[];
  focusedOrdinal?: number;
}): TrustedInterpreterInput {
  const entities = (args.presentedEntities ?? []).slice(0, 20).map((entity, index) => ({
    handle: `presented_${index + 1}`,
    kind: entity.kind,
    label: entity.label.slice(0, 120),
    ordinal: index + 1,
  }));
  const focused = args.focusedOrdinal !== undefined ? entities[args.focusedOrdinal - 1] : undefined;
  const anchor = args.state.control.dialogueAnchor;
  return {
    currentUserMessage: args.currentUserMessage.slice(0, 8000),
    taskContext: {
      lifecycle: args.state.lifecycle,
      ...(args.state.user.requestedGoal !== undefined ? { requestedGoal: args.state.user.requestedGoal } : {}),
      stay: { ...args.state.user.stay },
      ...(args.state.user.requestedRoomCount !== undefined ? { requestedRoomCount: args.state.user.requestedRoomCount } : {}),
      ...(args.state.user.operationIntent !== undefined ? { operationIntent: args.state.user.operationIntent } : {}),
      hasGroundedSelection: Boolean(args.state.control.groundedSelection),
      groundedSelectionCount: args.state.control.groundedSelection?.roomIds.length ?? 0,
      hasGroundedBookingTarget: Boolean(args.state.control.groundedBookingTarget),
      ...(args.state.control.preparedOperation
        ? { pendingOperation: { operationType: args.state.control.preparedOperation.operationType, status: args.state.control.preparedOperation.status } }
        : {}),
      retryableFailureCount: args.state.observations.failures.length,
    },
    ...(entities.length > 0 ? { presentationContext: { entities, ...(focused ? { focusedHandle: focused.handle } : {}) } } : {}),
    ...(anchor
      ? {
          dialogueAnchor: {
            kind: anchor.kind,
            hasPresentedSet: entities.length > 0,
            hasFocusedEntity: Boolean(focused),
          },
        }
      : {}),
    temporalContext: { ...args.temporalContext },
    domainSemanticContract: {
      contractId: "hotel_semantics_v1@1",
      goals: ["availability", "quote", "reservation", "cancellation", "modification"],
      operationIntents: ["reserve", "cancel", "modify"],
      readKinds: ["availability", "quote", "compare_price", "show_options", "booking_lookup", "knowledge_query"],
      contextualReferenceRoles: ["focused_entity", "current_selection", "presented_set"],
    },
  };
}

export type InterpreterAdmissionRejection =
  | "invalid_output_schema"
  | "invalid_semantic_combination"
  | "invalid_contextual_reference"
  | "invalid_temporal_provenance";

export type InterpreterAdmission =
  | { ok: true; output: InterpreterOutput }
  | { ok: false; rejection: InterpreterAdmissionRejection };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function stringValue(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function positiveInt(value: unknown, max: number): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= max;
}

function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function patch<T>(value: unknown, validate: (item: unknown) => item is T): value is { op: "set"; value: T } | { op: "clear" } {
  if (!record(value) || !exactKeys(value, ["op", "value"]) || (value.op !== "set" && value.op !== "clear")) return false;
  if (value.op === "clear") return Object.keys(value).length === 1;
  return Object.keys(value).length === 2 && validate(value.value);
}

const goal = (v: unknown): v is RequestedGoal =>
  v === "availability" || v === "quote" || v === "reservation" || v === "cancellation" || v === "modification";
const operation = (v: unknown): v is OperationIntent => v === "reserve" || v === "cancel" || v === "modify";

function roomReference(value: unknown): value is RoomReference {
  if (!record(value) || !stringValue(value.kind, 40)) return false;
  switch (value.kind) {
    case "room_number":
      return exactKeys(value, ["kind", "value"]) && stringValue(value.value, 40);
    case "ordinal":
      return exactKeys(value, ["kind", "value"]) && positiveInt(value.value, 20);
    case "ordinal_set":
      return exactKeys(value, ["kind", "values"]) && Array.isArray(value.values) && value.values.length > 0 && value.values.length <= 10 && value.values.every((v) => positiveInt(v, 20)) && new Set(value.values).size === value.values.length;
    case "relation":
      return exactKeys(value, ["kind", "value"]) && (value.value === "other" || value.value === "both");
    case "contextual_anchor":
      return exactKeys(value, ["kind", "role"]) && (value.role === "focused_entity" || value.role === "current_selection" || value.role === "presented_set");
    default:
      return false;
  }
}

function bookingReference(value: unknown): value is BookingReference {
  if (!record(value) || !stringValue(value.kind, 40)) return false;
  if (value.kind === "visible_reference") return exactKeys(value, ["kind", "value"]) && stringValue(value.value, 120);
  if (value.kind === "contextual_anchor") {
    return exactKeys(value, ["kind", "role"]) && (value.role === "focused_entity" || value.role === "current_selection");
  }
  return false;
}

function occupancy(value: unknown): value is RequestedOccupancy {
  if (!record(value) || !stringValue(value.kind, 40)) return false;
  if (value.kind === "ordered_distribution") {
    return exactKeys(value, ["kind", "guestsPerRoom"]) && Array.isArray(value.guestsPerRoom) && value.guestsPerRoom.length > 0 && value.guestsPerRoom.length <= 10 && value.guestsPerRoom.every((v) => positiveInt(v, 20));
  }
  if (value.kind === "explicit_assignments") {
    return exactKeys(value, ["kind", "assignments"]) && Array.isArray(value.assignments) && value.assignments.length > 0 && value.assignments.length <= 10 && value.assignments.every((assignment) => record(assignment) && exactKeys(assignment, ["room", "guests"]) && roomReference(assignment.room) && positiveInt(assignment.guests, 20));
  }
  return false;
}

function ambiguity(value: unknown): value is UserAmbiguity {
  return record(value) && exactKeys(value, ["code", "field"]) && stringValue(value.code, 80) && (value.field === undefined || stringValue(value.field, 80));
}

function stringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 20 && value.every((item) => stringValue(item, 120));
}

function validateSemanticPatch(value: unknown): value is UserSemanticPatch {
  if (!record(value) || !exactKeys(value, ["requestedGoal", "stay", "preferences", "requestedSelectionReference", "requestedRoomCount", "requestedOccupancy", "operationIntent", "bookingReference", "ambiguity"])) return false;
  if (value.requestedGoal !== undefined && !patch(value.requestedGoal, goal)) return false;
  if (value.stay !== undefined) {
    if (!record(value.stay) || !exactKeys(value.stay, ["checkIn", "checkOut", "guests"])) return false;
    if (value.stay.checkIn !== undefined && !patch(value.stay.checkIn, isoDate)) return false;
    if (value.stay.checkOut !== undefined && !patch(value.stay.checkOut, isoDate)) return false;
    if (value.stay.guests !== undefined && !patch(value.stay.guests, (v): v is number => positiveInt(v, 20))) return false;
  }
  if (value.preferences !== undefined && !patch(value.preferences, stringList)) return false;
  if (value.requestedSelectionReference !== undefined && !patch(value.requestedSelectionReference, roomReference)) return false;
  if (value.requestedRoomCount !== undefined && !patch(value.requestedRoomCount, (v): v is number => positiveInt(v, 10))) return false;
  if (value.requestedOccupancy !== undefined && !patch(value.requestedOccupancy, occupancy)) return false;
  if (value.operationIntent !== undefined && !patch(value.operationIntent, operation)) return false;
  if (value.bookingReference !== undefined && !patch(value.bookingReference, bookingReference)) return false;
  if (value.ambiguity !== undefined && !patch(value.ambiguity, ambiguity)) return false;
  return true;
}

function validateDirectives(value: unknown): value is InterpreterDirectives {
  if (!record(value) || !exactKeys(value, ["retry", "readRequest", "showOptions", "abortCurrentOperation", "interaction"])) return false;
  if (value.retry !== undefined) {
    if (!record(value.retry) || !exactKeys(value.retry, ["targetOperation"])) return false;
    const target = value.retry.targetOperation;
    if (target !== undefined && target !== "availability" && target !== "quote" && target !== "reservation" && target !== "cancellation" && target !== "modification") return false;
  }
  if (value.readRequest !== undefined) {
    if (!record(value.readRequest) || !exactKeys(value.readRequest, ["kind", "target"])) return false;
    if (value.readRequest.kind !== "availability" && value.readRequest.kind !== "quote" && value.readRequest.kind !== "compare_price" && value.readRequest.kind !== "show_options" && value.readRequest.kind !== "booking_lookup" && value.readRequest.kind !== "knowledge_query") return false;
    if (value.readRequest.target !== undefined && value.readRequest.target !== "current_selection" && value.readRequest.target !== "presented_set" && value.readRequest.target !== "hotel" && value.readRequest.target !== "booking") return false;
  }
  if (value.showOptions !== undefined && typeof value.showOptions !== "boolean") return false;
  if (value.abortCurrentOperation !== undefined && typeof value.abortCurrentOperation !== "boolean") return false;
  if (value.interaction !== undefined && value.interaction !== "acknowledge" && value.interaction !== "social" && value.interaction !== "help") return false;
  return true;
}

function validateTemporal(value: unknown): value is TemporalResolutionProvenance {
  if (!record(value) || !exactKeys(value, ["expressionClass", "trustedNow", "timezone", "policyId", "normalized"])) return false;
  if (value.expressionClass !== "relative" && value.expressionClass !== "day_month" && value.expressionClass !== "month_name" && value.expressionClass !== "yearless_range" && value.expressionClass !== "explicit_date") return false;
  if (!stringValue(value.trustedNow, 80) || !stringValue(value.timezone, 80) || !stringValue(value.policyId, 80)) return false;
  if (!record(value.normalized) || !exactKeys(value.normalized, ["checkIn", "checkOut"])) return false;
  if (value.normalized.checkIn !== undefined && !isoDate(value.normalized.checkIn)) return false;
  if (value.normalized.checkOut !== undefined && !isoDate(value.normalized.checkOut)) return false;
  return true;
}

function referenceContextValid(reference: RoomReference | BookingReference, input: TrustedInterpreterInput): boolean {
  if (reference.kind !== "contextual_anchor") return true;
  if (reference.role === "focused_entity") return Boolean(input.dialogueAnchor?.hasFocusedEntity && input.presentationContext?.focusedHandle);
  if (reference.role === "current_selection") return input.taskContext.hasGroundedSelection || input.taskContext.hasGroundedBookingTarget;
  return reference.role === "presented_set" && Boolean(input.dialogueAnchor?.hasPresentedSet && input.presentationContext?.entities.length);
}

function semanticCombinationValid(output: InterpreterOutput, input: TrustedInterpreterInput): InterpreterAdmissionRejection | undefined {
  const changes = output.taskSemanticChanges;
  const directives = output.directives;
  if (output.classification !== "task" && changes !== undefined) return "invalid_semantic_combination";
  if (output.classification === "unknown" && directives !== undefined) return "invalid_semantic_combination";
  if (output.classification === "social" && directives && Object.keys(directives).some((key) => key !== "interaction")) return "invalid_semantic_combination";
  if (output.classification === "help" && directives && Object.keys(directives).some((key) => key !== "interaction")) return "invalid_semantic_combination";
  if (output.classification === "task" && changes === undefined && directives === undefined) return "invalid_semantic_combination";

  if (directives?.abortCurrentOperation === true) {
    if (!changes?.operationIntent || changes.operationIntent.op !== "clear") return "invalid_semantic_combination";
  }

  const selection = changes?.requestedSelectionReference;
  if (selection?.op === "set" && !referenceContextValid(selection.value, input)) return "invalid_contextual_reference";
  const booking = changes?.bookingReference;
  if (booking?.op === "set" && !referenceContextValid(booking.value, input)) return "invalid_contextual_reference";
  const occ = changes?.requestedOccupancy;
  if (occ?.op === "set") {
    if (occ.value.kind === "ordered_distribution") {
      const anchored = Boolean(input.dialogueAnchor?.kind === "occupancy" || input.taskContext.hasGroundedSelection || input.dialogueAnchor?.hasPresentedSet);
      if (!anchored) return "invalid_contextual_reference";
      const guestsPatch = changes?.stay?.guests;
      const effectiveGuests = guestsPatch?.op === "set" ? guestsPatch.value : guestsPatch?.op === "clear" ? undefined : input.taskContext.stay.guests;
      const total = occ.value.guestsPerRoom.reduce((sum, guests) => sum + guests, 0);
      if (effectiveGuests !== undefined && total !== effectiveGuests) return "invalid_semantic_combination";
    }
    if (occ.value.kind === "explicit_assignments" && occ.value.assignments.some((assignment) => !referenceContextValid(assignment.room, input))) {
      return "invalid_contextual_reference";
    }
  }

  const temporal = output.temporalResolutionProvenance;
  if (temporal) {
    if (temporal.trustedNow !== input.temporalContext.trustedNow || temporal.timezone !== input.temporalContext.timezone || temporal.policyId !== input.temporalContext.temporalPolicyId) return "invalid_temporal_provenance";
    const checkIn = changes?.stay?.checkIn;
    const checkOut = changes?.stay?.checkOut;
    if (temporal.normalized.checkIn !== undefined && (checkIn?.op !== "set" || checkIn.value !== temporal.normalized.checkIn)) return "invalid_temporal_provenance";
    if (temporal.normalized.checkOut !== undefined && (checkOut?.op !== "set" || checkOut.value !== temporal.normalized.checkOut)) return "invalid_temporal_provenance";
  }
  return undefined;
}

export function admitInterpreterOutput(raw: unknown, input: TrustedInterpreterInput): InterpreterAdmission {
  if (!record(raw) || !exactKeys(raw, ["classification", "taskSemanticChanges", "directives", "temporalResolutionProvenance"])) return { ok: false, rejection: "invalid_output_schema" };
  if (raw.classification !== "task" && raw.classification !== "social" && raw.classification !== "help" && raw.classification !== "unknown") return { ok: false, rejection: "invalid_output_schema" };
  if (raw.taskSemanticChanges !== undefined && !validateSemanticPatch(raw.taskSemanticChanges)) return { ok: false, rejection: "invalid_output_schema" };
  if (raw.directives !== undefined && !validateDirectives(raw.directives)) return { ok: false, rejection: "invalid_output_schema" };
  if (raw.temporalResolutionProvenance !== undefined && !validateTemporal(raw.temporalResolutionProvenance)) return { ok: false, rejection: "invalid_output_schema" };

  const output: InterpreterOutput = {
    classification: raw.classification,
    ...(raw.taskSemanticChanges !== undefined ? { taskSemanticChanges: raw.taskSemanticChanges as UserSemanticPatch } : {}),
    ...(raw.directives !== undefined ? { directives: raw.directives as InterpreterDirectives } : {}),
    ...(raw.temporalResolutionProvenance !== undefined ? { temporalResolutionProvenance: raw.temporalResolutionProvenance as TemporalResolutionProvenance } : {}),
  };
  const rejection = semanticCombinationValid(output, input);
  return rejection ? { ok: false, rejection } : { ok: true, output };
}

export type InterpreterServerEnvelope = {
  eventId: string;
  sessionId: string;
  taskId: string;
  expectedStateRevision: number;
  occurredAt: string;
  causationId?: string;
};

export type InterpreterArtifacts = {
  userSemanticEvent?: UserSemanticEvent;
  planningTrigger: PlanningTrigger;
  temporalResolutionProvenance?: TemporalResolutionProvenance;
};

function nonEmptyPatch(patchValue: UserSemanticPatch | undefined): patchValue is UserSemanticPatch {
  return Boolean(patchValue && Object.keys(patchValue).length > 0);
}

export function materializeInterpreterArtifacts(output: InterpreterOutput, server: InterpreterServerEnvelope): InterpreterArtifacts {
  const directives = output.directives;
  const read = directives?.readRequest;
  const planningTrigger: PlanningTrigger = {
    origin: "user",
    acceptedEventId: server.eventId,
    ...(directives?.retry ? { retryDirective: { ...(directives.retry.targetOperation ? { targetOperation: directives.retry.targetOperation } : {}) } } : {}),
    ...(read && read.kind !== "show_options"
      ? { readDirective: { kind: read.kind === "compare_price" ? "compare" : read.kind, ...(read.target ? { target: read.target } : {}) } }
      : {}),
    ...(directives?.showOptions === true || read?.kind === "show_options" ? { showOptionsDirective: true } : {}),
    ...(directives?.abortCurrentOperation === true ? { abortDirective: true } : {}),
    ...(directives?.interaction
      ? { interactionDirective: directives.interaction }
      : output.classification === "social"
        ? { interactionDirective: "social" }
        : output.classification === "help"
          ? { interactionDirective: "help" }
          : {}),
  };
  const semanticPatch = output.taskSemanticChanges;
  const userSemanticEvent = nonEmptyPatch(semanticPatch)
    ? {
        eventId: server.eventId,
        kind: "user_semantic" as const,
        sessionId: server.sessionId,
        taskId: server.taskId,
        expectedStateRevision: server.expectedStateRevision,
        occurredAt: server.occurredAt,
        ...(server.causationId !== undefined ? { causationId: server.causationId } : {}),
        payload: semanticPatch,
      }
    : undefined;
  return {
    ...(userSemanticEvent ? { userSemanticEvent } : {}),
    planningTrigger,
    ...(output.temporalResolutionProvenance ? { temporalResolutionProvenance: output.temporalResolutionProvenance } : {}),
  };
}
