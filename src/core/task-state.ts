export type TaskLifecycle = "active" | "completed" | "abandoned" | "superseded";
export type TaskGoal = "availability" | "quote" | "reservation" | "cancellation" | "modification";
export type OperationKind = "reserve" | "cancel" | "modify";
export type AuthoritySource = "user" | "tool" | "server" | "legacy";
export type DependencyFingerprint = string;
export type OperationFingerprint = string;
export type TaskDependencyKey =
  | "requestedGoal"
  | "requestedStay.checkIn"
  | "requestedStay.checkOut"
  | "requestedStay.guests"
  | "preferences"
  | "requestedRoomCount"
  | "requestedSelectionReference"
  | "bookingReference"
  | "operationIntent"
  | "availability"
  | "groundedSelection"
  | "quote";

export type FactProvenance = {
  source: AuthoritySource;
  revision: number;
};

export type TaskFact<T> = {
  value: T;
  provenance: FactProvenance;
};

/** Field omission means noChange; null is deliberately not overloaded. */
export type FieldPatch<T> =
  | { op: "set"; value: T }
  | { op: "clear" };

export type RequestedStay = {
  checkIn?: TaskFact<string>;
  checkOut?: TaskFact<string>;
  guests?: TaskFact<number>;
};

export type RoomReference =
  | { kind: "room_number"; roomNumber: string; scope: "entity_scoped" }
  | { kind: "ordinal"; ordinal: number; scope: "observation_scoped" }
  | { kind: "ordinal_set"; ordinals: readonly number[]; scope: "observation_scoped" }
  | { kind: "relation"; relation: "other" | "both"; scope: "observation_scoped" }
  | { kind: "descriptive_preference"; value: string; scope: "entity_scoped" }
  | { kind: "ambiguous"; reasonCode: string; scope: "observation_scoped" };

export type BookingReference =
  | { kind: "explicit_code"; code: string }
  | { kind: "ordinal"; ordinal: number }
  | { kind: "descriptive"; value: string }
  | { kind: "ambiguous"; reasonCode: string };

export type OperationIntent = {
  kind: OperationKind;
  status: "active" | "cleared" | "ambiguous";
  targetSemanticReference?: RoomReference | BookingReference;
  provenance: FactProvenance;
};

export type OperationIntentPatchValue = Omit<OperationIntent, "provenance">;

export type UserSemanticStatePatch = {
  requestedGoal?: FieldPatch<TaskGoal>;
  checkIn?: FieldPatch<string>;
  checkOut?: FieldPatch<string>;
  guests?: FieldPatch<number>;
  requestedRoomCount?: FieldPatch<number>;
  requestedSelectionReference?: FieldPatch<RoomReference>;
  bookingReference?: FieldPatch<BookingReference>;
  operationIntent?: FieldPatch<OperationIntentPatchValue>;
  preferences?: FieldPatch<readonly string[]>;
};

export type AvailabilityCandidate = {
  roomId: string;
  roomNumber?: string;
  roomType?: string;
  capacity?: number;
};

export type GuestCapacityCoverage = "enforced" | "not_modeled";

export type AvailabilityObservation = {
  status: "not_queried" | "pending" | "observed" | "failed";
  observationRevision?: number;
  dependencyFingerprint?: DependencyFingerprint;
  dependencyKeys: readonly TaskDependencyKey[];
  querySnapshot?: Readonly<Record<string, unknown>>;
  rooms: readonly AvailabilityCandidate[];
  guestCapacityCoverage?: GuestCapacityCoverage;
  observedAt?: string;
};

export type QuoteObservation = {
  status: "not_queried" | "pending" | "observed" | "failed";
  observationRevision?: number;
  dependencyFingerprint?: DependencyFingerprint;
  dependencyKeys: readonly TaskDependencyKey[];
  roomIds: readonly string[];
  amountCents?: number;
  currency?: string;
  observedAt?: string;
};

export type ExecutionOutcomeKind =
  | "booking_created"
  | "bookings_created"
  | "booking_cancelled"
  | "bookings_cancelled"
  | "booking_modified"
  | "booking_created_partial"
  | "booking_cancelled_partial";

export type ExecutionState = {
  status: "not_started" | "executing" | "confirmed" | "failed";
  operationId?: string;
  operationFingerprint?: OperationFingerprint;
  dependencyFingerprint?: DependencyFingerprint;
  outcomeKind?: ExecutionOutcomeKind;
  failureCode?: string;
};

export type GroundedSelection = {
  status: "none" | "requested" | "grounded" | "ambiguous" | "stale";
  roomIds: readonly string[];
  basedOnAvailabilityRevision?: number;
  dependencyFingerprint?: DependencyFingerprint;
  dependencyKeys: readonly TaskDependencyKey[];
};

export type BookingObservation = {
  bookingId: string;
  status?: string;
  roomIds?: readonly string[];
  observationRevision: number;
};

export type PendingToolInvocation = {
  invocationId: string;
  capabilityId: string;
  status: "pending" | "succeeded" | "failed" | "superseded";
  dependencyFingerprint: DependencyFingerprint;
  dependencyKeys: readonly TaskDependencyKey[];
  inputSnapshot: Readonly<Record<string, unknown>>;
  startedAt: string;
};

export type PreparedOperation = {
  operationId: string;
  operationType: OperationKind;
  /** Exact server-built domain capability approved/prepared for later execution. */
  capabilityId: "reserve_single" | "reserve_multi" | "cancel_single" | "cancel_multi" | "modify";
  /** Exact registry binding. Approval resume must never infer a tool from operationType. */
  toolId: string;
  operationFingerprint: OperationFingerprint;
  dependencyFingerprint: DependencyFingerprint;
  dependencyKeys: readonly TaskDependencyKey[];
  canonicalInputSnapshot: Readonly<Record<string, unknown>>;
  status: "prepared" | "approval_required" | "approved" | "invalidated";
};

/** User-visible semantic identity retained only after an output is actually published. */
export type PublishedSemanticEntity =
  | { entityType: "room"; ordinal: number; roomNumber?: string; label?: string }
  | { entityType: "booking"; ordinal: number; bookingCode?: string; label?: string };

export type PublishedDialogueAnchor = {
  kind: "dates" | "check_out" | "guests" | "selection" | "occupancy" | "booking_reference" | "confirmation" | "other_bounded";
  presentedEntities?: readonly PublishedSemanticEntity[];
  focusedEntity?: PublishedSemanticEntity;
  lastQuestionPurpose?: string;
};

export type PublishedPendingClarification = {
  responseId: string;
  responseDependencyFingerprint: DependencyFingerprint;
  field: "dates" | "check_in" | "check_out" | "guests" | "selection" | "booking_reference" | "retry_target";
  reason: string;
};

export type ConversationControlState = {
  activeDialogueAnchor?: PublishedDialogueAnchor;
  pendingClarification?: PublishedPendingClarification;
  lastPublishedResponseId?: string;
  lastPublishedResponseDependencyFingerprint?: DependencyFingerprint;
  lastPublishedAt?: string;
};

export type TaskStateV1 = {
  taskId: string;
  sessionId: string;
  taskType: "hotel_reservation_domain";
  lifecycle: TaskLifecycle;
  stateRevision: number;
  recentEventIds: readonly string[];
  requestedGoal?: TaskFact<TaskGoal>;
  requestedStay: RequestedStay;
  preferences: readonly TaskFact<string>[];
  requestedRoomCount?: TaskFact<number>;
  requestedSelectionReference?: TaskFact<RoomReference>;
  bookingReference?: TaskFact<BookingReference>;
  operationIntent?: OperationIntent;
  availability: AvailabilityObservation;
  quote: QuoteObservation;
  groundedSelection: GroundedSelection;
  bookings: readonly BookingObservation[];
  pendingToolInvocation?: PendingToolInvocation;
  preparedOperation?: PreparedOperation;
  execution: ExecutionState;
  /** Server-owned conversational control. Never populated before output publication commits. */
  conversationControl?: ConversationControlState;
};