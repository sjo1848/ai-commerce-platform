import type {
  BookingReference,
  FieldPatch,
  OperationIntentPatchValue,
  RoomReference,
  TaskGoal,
  TaskStateV1,
  UserSemanticStatePatch,
} from "./task-state.js";

export type InterpreterClassification = "task" | "social" | "help" | "unknown";
export type InterpreterReadKind = "availability" | "quote" | "compare_price" | "show_options" | "booking_lookup" | "knowledge_query";
export type InterpreterRetryTarget = "availability" | "quote" | "current_operation";
export type InterpreterInteraction = "acknowledge" | "social" | "help";
export type InterpreterAmbiguityTopic = "dates" | "guests" | "selection" | "booking_reference" | "occupancy" | "operation_intent" | "other";

export type InterpreterTaskContextProjection = {
  taskType: "hotel_reservation_domain";
  lifecycle: TaskStateV1["lifecycle"];
  requestedGoal?: TaskGoal;
  requestedStay: { checkIn?: string; checkOut?: string; guests?: number };
  requestedRoomCount?: number;
  requestedSelectionReference?: RoomReference;
  bookingReference?: BookingReference;
  operationIntent?: Omit<OperationIntentPatchValue, "status"> & { status: "active" | "ambiguous" };
  availabilitySummary: { status: TaskStateV1["availability"]["status"]; candidateCount?: number };
  groundedSelectionSummary: { status: TaskStateV1["groundedSelection"]["status"]; count: number };
  bookingSummary: { count: number };
};

export type PresentedSemanticEntity =
  | { entityType: "room"; ordinal: number; roomNumber?: string; label?: string }
  | { entityType: "booking"; ordinal: number; bookingCode?: string; label?: string };

export type DialogueAnchor = {
  kind: "dates" | "check_out" | "guests" | "selection" | "occupancy" | "booking_reference" | "confirmation" | "other_bounded";
  presentedEntities?: readonly PresentedSemanticEntity[];
  focusedEntity?: PresentedSemanticEntity;
  lastQuestionPurpose?: string;
};

export type InterpreterTemporalContext = {
  trustedNow: string;
  timezone: string;
  locale: string;
  calendarPolicyId: string;
  temporalPolicyVersion: string;
};

export type DomainSemanticContract = {
  id: "hotel_semantics_v1";
  allowedGoals: readonly TaskGoal[];
  allowedOperationIntents: readonly ("reserve" | "cancel" | "modify")[];
  allowedReadRequests: readonly InterpreterReadKind[];
};

export const HOTEL_SEMANTIC_CONTRACT_V1: DomainSemanticContract = {
  id: "hotel_semantics_v1",
  allowedGoals: ["availability", "quote", "reservation", "cancellation", "modification"],
  allowedOperationIntents: ["reserve", "cancel", "modify"],
  allowedReadRequests: ["availability", "quote", "compare_price", "show_options", "booking_lookup", "knowledge_query"],
};

export type InterpreterInput = {
  currentUserMessage: string;
  taskContextProjection: InterpreterTaskContextProjection;
  dialogueAnchor?: DialogueAnchor;
  temporalContext: InterpreterTemporalContext;
  domainSemanticContract: DomainSemanticContract;
};

export type InterpreterAmbiguity = {
  topic: InterpreterAmbiguityTopic;
  reasonCode: string;
  candidateMeaningTypes?: readonly string[];
};

export type InterpreterDirectives = {
  retry?: { target?: InterpreterRetryTarget };
  readRequest?: { kind: InterpreterReadKind; fields?: readonly string[] };
  showOptions?: true;
  abortCurrentOperation?: true;
  interaction?: InterpreterInteraction;
};

export type TemporalResolutionProvenance = {
  expressionClass: string;
  trustedNow: string;
  timezone: string;
  locale: string;
  normalizedDates: { checkIn?: string; checkOut?: string };
  resolutionPolicyId: string;
  resolutionPolicyVersion: string;
};

export type InterpreterTaskSemanticChanges = UserSemanticStatePatch & {
  ambiguity?: InterpreterAmbiguity;
};

export type InterpreterOutput = {
  classification: InterpreterClassification;
  taskSemanticChanges?: InterpreterTaskSemanticChanges;
  directives?: InterpreterDirectives;
  temporalResolutionProvenance?: TemporalResolutionProvenance;
};

/** Provider adapter only interprets semantics. It does not plan or execute. */
export interface SemanticInterpreterAdapter {
  interpret(input: Readonly<InterpreterInput>): Promise<unknown>;
}

export function projectTaskStateForInterpreter(state: Readonly<TaskStateV1>): InterpreterTaskContextProjection {
  const operationIntent = state.operationIntent && state.operationIntent.status !== "cleared"
    ? (() => {
        const { provenance: _provenance, ...semanticIntent } = state.operationIntent;
        return semanticIntent as InterpreterTaskContextProjection["operationIntent"];
      })()
    : undefined;
  return {
    taskType: state.taskType,
    lifecycle: state.lifecycle,
    requestedStay: {
      ...(state.requestedStay.checkIn ? { checkIn: state.requestedStay.checkIn.value } : {}),
      ...(state.requestedStay.checkOut ? { checkOut: state.requestedStay.checkOut.value } : {}),
      ...(state.requestedStay.guests ? { guests: state.requestedStay.guests.value } : {}),
    },
    availabilitySummary: {
      status: state.availability.status,
      ...(state.availability.status === "observed" ? { candidateCount: state.availability.rooms.length } : {}),
    },
    groundedSelectionSummary: { status: state.groundedSelection.status, count: state.groundedSelection.roomIds.length },
    bookingSummary: { count: state.bookings.length },
    ...(state.requestedGoal ? { requestedGoal: state.requestedGoal.value } : {}),
    ...(state.requestedRoomCount ? { requestedRoomCount: state.requestedRoomCount.value } : {}),
    ...(state.requestedSelectionReference ? { requestedSelectionReference: state.requestedSelectionReference.value } : {}),
    ...(state.bookingReference ? { bookingReference: state.bookingReference.value } : {}),
    ...(operationIntent ? { operationIntent } : {}),
  };
}
