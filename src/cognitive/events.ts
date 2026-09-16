import type {
  AvailabilityObservation,
  BookingObservation,
  BookingReference,
  DialogueAnchor,
  ExplicitPatch,
  GroundedBookingTarget,
  GroundedSelection,
  OperationIntent,
  PendingToolInvocation,
  PreparedOperation,
  QuoteObservation,
  RequestedGoal,
  RequestedOccupancy,
  RoomReference,
  TaskLifecycle,
  ToolFailure,
  UserAmbiguity,
} from "./contracts.js";

export type UserSemanticPatch = {
  requestedGoal?: ExplicitPatch<RequestedGoal>;
  stay?: { checkIn?: ExplicitPatch<string>; checkOut?: ExplicitPatch<string>; guests?: ExplicitPatch<number> };
  preferences?: ExplicitPatch<readonly string[]>;
  requestedSelectionReference?: ExplicitPatch<RoomReference>;
  requestedRoomCount?: ExplicitPatch<number>;
  requestedOccupancy?: ExplicitPatch<RequestedOccupancy>;
  operationIntent?: ExplicitPatch<OperationIntent>;
  bookingReference?: ExplicitPatch<BookingReference>;
  ambiguity?: ExplicitPatch<UserAmbiguity>;
};
export type InvocationAuthorityRef = { kind: "invocation"; invocationId: string; dependencyFingerprint: string };
export type OperationAuthorityRef = { kind: "operation"; operationId: string; operationFingerprint: string; dependencyFingerprint: string };
export type ToolAuthorityRef = InvocationAuthorityRef | OperationAuthorityRef;
export type ToolObservationPayload =
  | { kind: "availability"; authority: InvocationAuthorityRef; observation: AvailabilityObservation }
  | { kind: "quote"; authority: InvocationAuthorityRef; observation: QuoteObservation }
  | { kind: "booking"; authority: ToolAuthorityRef; observation: BookingObservation }
  | { kind: "execution_succeeded"; authority: OperationAuthorityRef; operationType: OperationIntent; observationId?: string }
  | { kind: "failure"; authority: ToolAuthorityRef; failure: ToolFailure };

export type ToolControlFailureReason =
  | "policy_denied"
  | "input_rejected"
  | "lease_expired"
  | "precondition_superseded"
  | "admission_error"
  | "effect_changed";

export type ServerControlPayload =
  | { kind: "reference_grounded"; groundedSelection: GroundedSelection }
  | { kind: "booking_reference_grounded"; groundedBookingTarget: GroundedBookingTarget }
  | { kind: "invocation_recorded"; invocation: PendingToolInvocation }
  | { kind: "invocation_dispatched"; invocationId: string; startedAt: string; dispatchCorrelationId?: string }
  | { kind: "invocation_terminal"; invocationId: string; status: "failed" | "superseded" | "expired"; terminalCorrelationId?: string }
  | { kind: "prepared_operation_recorded"; operation: PreparedOperation }
  | { kind: "prepared_operation_status_changed"; operationId: string; operationFingerprint: string; status: "approval_required" | "approved" | "invalidated" }
  | { kind: "tool_control_failure"; phase: "admission" | "recovery"; capabilityId: string; reasonCode: ToolControlFailureReason }
  | { kind: "dialogue_anchor_set"; anchor: DialogueAnchor }
  | { kind: "dialogue_anchor_clear"; anchorId?: string }
  | { kind: "lifecycle_changed"; lifecycle: TaskLifecycle };
export type TaskEventEnvelope<K extends string, P> = { eventId: string; kind: K; sessionId: string; taskId: string; expectedStateRevision: number; occurredAt: string; causationId?: string; payload: P };
export type UserSemanticEvent = TaskEventEnvelope<"user_semantic", UserSemanticPatch>;
export type ToolObservationEvent = TaskEventEnvelope<"tool_observation", ToolObservationPayload>;
export type ServerControlEvent = TaskEventEnvelope<"server_control", ServerControlPayload>;
export type TaskEvent = UserSemanticEvent | ToolObservationEvent | ServerControlEvent;
export type TaskStateRejection =
  | "invalid_event_envelope"
  | "wrong_session"
  | "wrong_task"
  | "stale_state_revision"
  | "invalid_user_semantics"
  | "invalid_tool_authority"
  | "invalid_server_control"
  | "state_invariant_violation";
export type InvalidationTarget = "observations.availability" | "observations.quote" | "observations.booking" | "control.groundedSelection" | "control.groundedBookingTarget" | "control.pendingToolInvocation" | "control.preparedOperation" | "control.dialogueAnchor";
export type TaskStateInvalidation = { target: InvalidationTarget; reason: "dependency_changed" | "observation_replaced"; causedBy: readonly string[] };
export type TaskStateReduction = { state: import("./contracts.js").TaskState; accepted: boolean; material: boolean; duplicate: boolean; invalidations: readonly TaskStateInvalidation[]; rejection?: TaskStateRejection };
