export type TaskLifecycle = "active" | "completed" | "abandoned" | "superseded";
export type RequestedGoal = "availability" | "quote" | "reservation" | "cancellation" | "modification";
export type OperationIntent = "reserve" | "cancel" | "modify";

export type ExplicitPatch<T> =
  | { op: "set"; value: T }
  | { op: "clear" };

export type RoomReference =
  | { kind: "room_number"; value: string }
  | { kind: "ordinal"; value: number }
  | { kind: "ordinal_set"; values: readonly number[] }
  | { kind: "relation"; value: "other" | "both" }
  | { kind: "contextual_anchor"; role: "focused_entity" | "current_selection" | "presented_set" };

export type BookingReference =
  | { kind: "visible_reference"; value: string }
  | { kind: "contextual_anchor"; role: "focused_entity" | "current_selection" };

export type RequestedOccupancy =
  | { kind: "ordered_distribution"; guestsPerRoom: readonly number[] }
  | { kind: "explicit_assignments"; assignments: readonly { room: RoomReference; guests: number }[] };

export type UserAmbiguity = {
  code: string;
  field?: string;
};

export type UserRequestedSemantics = {
  requestedGoal?: RequestedGoal;
  stay: { checkIn?: string; checkOut?: string; guests?: number };
  preferences: readonly string[];
  requestedSelectionReference?: RoomReference;
  requestedRoomCount?: number;
  requestedOccupancy?: RequestedOccupancy;
  operationIntent?: OperationIntent;
  bookingReference?: BookingReference;
  ambiguity?: UserAmbiguity;
};

/**
 * Paths identify causal dependencies; they are not a generic object-path DSL.
 * Domain contracts select from this bounded vocabulary when creating derived
 * observations/control artifacts. Reducer invalidation is generic intersection.
 */
export type DependencyPath =
  | "lifecycle"
  | "user.requestedGoal"
  | "user.stay.checkIn"
  | "user.stay.checkOut"
  | "user.stay.guests"
  | "user.preferences"
  | "user.requestedSelectionReference"
  | "user.requestedRoomCount"
  | "user.requestedOccupancy"
  | "user.operationIntent"
  | "user.bookingReference"
  | "user.ambiguity"
  | "observations.availability"
  | "observations.quote"
  | "observations.booking"
  | "control.groundedSelection"
  | "control.groundedBookingTarget"
  | "control.pendingToolInvocation"
  | "control.preparedOperation"
  | "control.dialogueAnchor";

export type DependencyBound = {
  dependencyFingerprint: string;
  dependencyPaths: readonly DependencyPath[];
};

export type AvailabilityCandidate = {
  roomId: string;
  roomNumber?: string;
  roomType?: string;
  capacity?: number;
};

export type AvailabilityObservation = DependencyBound & {
  observationId: string;
  status: "observed";
  source: "tool";
  query: { checkIn: string; checkOut: string; guests: number };
  rooms: readonly AvailabilityCandidate[];
};

export type QuoteObservation = DependencyBound & {
  observationId: string;
  status: "observed";
  source: "tool";
  roomId: string;
  totalCents: number;
  currency: string;
};

export type BookingObservation = DependencyBound & {
  observationId: string;
  status: string;
  source: "tool";
  bookingId: string;
};

export type ExecutionResult = {
  operationId: string;
  operationType: OperationIntent;
  status: "succeeded" | "failed";
  observationId?: string;
};

export type ToolFailure = DependencyBound & {
  failureId: string;
  capabilityId: string;
  authorityKind: "invocation" | "operation";
  authorityId: string;
  code: string;
  occurredAt: string;
};

export type ToolObservations = {
  availability?: AvailabilityObservation;
  quote?: QuoteObservation;
  booking?: BookingObservation;
  executionResults: readonly ExecutionResult[];
  failures: readonly ToolFailure[];
};

export type GroundedSelection = DependencyBound & {
  roomIds: readonly string[];
  sourceObservationId: string;
  authority: "server";
};

export type GroundedBookingTarget = DependencyBound & {
  bookingId: string;
  sourceObservationId: string;
  authority: "server";
};

export type PendingToolInvocation = DependencyBound & {
  invocationId: string;
  capabilityId: string;
  status: "admitted" | "dispatched" | "succeeded" | "failed" | "superseded" | "expired";
  inputSnapshot: Readonly<Record<string, unknown>>;
  admittedAt: string;
  startedAt?: string;
  leaseExpiresAt: string;
  dispatchCorrelationId?: string;
  terminalCorrelationId?: string;
};

export type PreparedOperation = DependencyBound & {
  operationId: string;
  operationType: OperationIntent;
  operationFingerprint: string;
  /**
   * Exact Core capability identity selected before approval. Optional only for
   * compatibility with pre-I6 synthetic state; I6 execution refuses to resume
   * an approved operation unless both fields are present and current.
   */
  capabilityId?: string;
  capabilityContractIdentity?: string;
  inputSnapshot: Readonly<Record<string, unknown>>;
  status: "prepared" | "approval_required" | "approved" | "invalidated";
};

/**
 * Published conversational context only. Candidate identifiers are server-owned
 * handles from the authoritative surface/observation, never model-authored truth.
 * Focus/selection are stored separately from candidateScope so reduce-before-
 * ground can resolve "esa" / "la otra" after old operational grounding has
 * been causally invalidated by the new user reference.
 */
export type DialogueAnchor = {
  anchorId: string;
  kind: "dates" | "check_out" | "guests" | "selection" | "occupancy" | "booking_reference" | "confirmation" | "other_bounded";
  createdAtStateRevision: number;
  dependencyFingerprint?: string;
  dependencyPaths: readonly DependencyPath[];
  referencedObservationId?: string;
  candidateScope?: readonly string[];
  focusedCandidate?: string;
  selectedCandidates?: readonly string[];
};

export type ServerControlState = {
  groundedSelection?: GroundedSelection;
  groundedBookingTarget?: GroundedBookingTarget;
  pendingToolInvocation?: PendingToolInvocation;
  preparedOperation?: PreparedOperation;
  dialogueAnchor?: DialogueAnchor;
};

export type TaskStateProvenance = {
  migratedFromConversationState?: {
    semanticMemoryRevision: number;
    roomSelectionRevision?: number;
    bookingStateRevision?: number;
  };
};

export type TaskState = {
  schemaVersion: "acp-task-state-v1";
  sessionId: string;
  taskId: string;
  lifecycle: TaskLifecycle;
  stateRevision: number;
  recentEventIds: readonly string[];
  user: UserRequestedSemantics;
  observations: ToolObservations;
  control: ServerControlState;
  provenance: TaskStateProvenance;
};

/**
 * Compatibility data extracted from the legacy ConversationState boundary.
 * It is deliberately NOT TaskState and must never be handed to Planner as
 * current operational truth. Migration code may use it only to decide what
 * must be re-observed/re-grounded before ACP-3.0 can act on it.
 */
export type LegacyCompatibilitySnapshot = {
  stay: { checkIn?: string; checkOut?: string; guests?: number };
  availabilityRooms: readonly AvailabilityCandidate[];
  selectedRoomIds: readonly string[];
  requestedRoomCount?: number;
  roomOccupancy: readonly { roomId: string; guests: number }[];
  activeBookingId?: string;
  bookingStatus?: string;
};

export type TaskStateMigrationSeed = {
  taskState: TaskState;
  legacyCompatibility: LegacyCompatibilitySnapshot;
};

export type RetryDirective = { targetOperation?: string; correlationId?: string };
export type ReadDirective = { kind: string; target?: string };

export type PlanningTrigger = {
  origin: "user" | "tool" | "server";
  acceptedEventId: string;
  correlationId?: string;
  retryDirective?: RetryDirective;
  readDirective?: ReadDirective;
  showOptionsDirective?: boolean;
  abortDirective?: boolean;
  interactionDirective?: "acknowledge" | "social" | "help";
  observationKind?: string;
  controlKind?: string;
};

export type NextStep =
  | {
      kind: "ASK";
      field: string;
      reason: string;
      presentationContext?: Readonly<Record<string, unknown>>;
      dialogueAnchorSpec: Omit<DialogueAnchor, "anchorId" | "createdAtStateRevision">;
    }
  | {
      kind: "CALL_TOOL";
      capabilityId: string;
      groundedInput: Readonly<Record<string, unknown>>;
      preconditionFingerprint: string;
      correlationIntent: string;
      effectClass: "read" | "write";
    }
  | { kind: "RESPOND"; responseIntent: string; groundedReferences: readonly string[] }
  | { kind: "WAIT"; reason: "tool_pending" | "approval_pending" | "external_event"; correlationId?: string }
  | { kind: "COMPLETE"; completionReason: string; responseIntent: string; groundedReferences: readonly string[] }
  | { kind: "DEGRADE"; reasonCode: string; recoverable: boolean; responseIntent: string };

export type OrchestrationDisposition =
  | "INTERNAL_PREPLAN"
  | "STATE_ONLY"
  | "PLANNING_TRIGGER"
  | "RESUME_EXECUTION"
  | "TERMINAL_NO_PLAN";

export type OrchestrationCycleRecord = {
  cycleId: string;
  acceptedEventId: string;
  origin: PlanningTrigger["origin"];
  status: "accepted" | "reduced" | "planned" | "completed" | "failed";
  directives: Omit<PlanningTrigger, "origin" | "acceptedEventId" | "correlationId" | "observationKind" | "controlKind">;
  correlationId?: string;
  /** Bounded deterministic Planner output persisted with status=planned for crash-safe handoff recovery. */
  plannedStep?: NextStep;
  plannedAtStateRevision?: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicationCommitRecord = {
  publicationId: string;
  responseDependencyFingerprint: string;
  status: "prepared" | "published" | "recovered" | "abandoned";
  dialogueAnchorCandidate?: Omit<DialogueAnchor, "createdAtStateRevision">;
  createdAt: string;
  publishedAt?: string;
};
