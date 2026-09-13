import type {
  AvailabilityCandidate,
  BookingObservation,
  DependencyFingerprint,
  PreparedOperation,
  TaskDependencyKey,
  TaskLifecycle,
  UserSemanticStatePatch,
} from "./task-state.js";

export type TaskEventBase = {
  eventId: string;
  taskId: string;
  sessionId: string;
};

export type RevisionGuardedTaskEventBase = TaskEventBase & {
  expectedStateRevision: number;
};

export type UserSemanticEvent = RevisionGuardedTaskEventBase & {
  kind: "user_semantic";
  sourceRevision: number;
  patch: UserSemanticStatePatch;
};

export type ToolInvocationStartedEvent = RevisionGuardedTaskEventBase & {
  kind: "tool_invocation_started";
  invocationId: string;
  capabilityId: string;
  dependencyFingerprint: DependencyFingerprint;
  dependencyKeys: readonly TaskDependencyKey[];
  inputSnapshot: Readonly<Record<string, unknown>>;
  startedAt: string;
};

export type AvailabilityObservedEvent = TaskEventBase & {
  kind: "availability_observed";
  invocationId: string;
  dependencyFingerprint: DependencyFingerprint;
  observationRevision: number;
  rooms: readonly AvailabilityCandidate[];
  observedAt: string;
};

export type AvailabilityFailedEvent = TaskEventBase & {
  kind: "availability_failed";
  invocationId: string;
  dependencyFingerprint: DependencyFingerprint;
};

export type QuoteObservedEvent = TaskEventBase & {
  kind: "quote_observed";
  invocationId: string;
  dependencyFingerprint: DependencyFingerprint;
  observationRevision: number;
  roomIds: readonly string[];
  amountCents: number;
  currency: string;
  observedAt: string;
};

export type QuoteFailedEvent = TaskEventBase & {
  kind: "quote_failed";
  invocationId: string;
  dependencyFingerprint: DependencyFingerprint;
};

export type SelectionGroundedEvent = RevisionGuardedTaskEventBase & {
  kind: "selection_grounded";
  roomIds: readonly string[];
  basedOnAvailabilityRevision: number;
  dependencyFingerprint: DependencyFingerprint;
  dependencyKeys: readonly TaskDependencyKey[];
};

export type OperationPreparedEvent = RevisionGuardedTaskEventBase & {
  kind: "operation_prepared";
  operation: PreparedOperation & { status: "prepared" | "approval_required" };
};

export type ApprovalStateChangedEvent = RevisionGuardedTaskEventBase & {
  kind: "approval_state_changed";
  operationId: string;
  operationFingerprint: string;
  dependencyFingerprint: string;
  status: "approved" | "invalidated";
};

export type ExecutionStartedEvent = RevisionGuardedTaskEventBase & {
  kind: "execution_started";
  operationId: string;
  operationFingerprint: string;
  dependencyFingerprint: string;
};

export type BookingCreatedEvent = TaskEventBase & {
  kind: "booking_created";
  operationId: string;
  operationFingerprint: string;
  dependencyFingerprint: string;
  booking: BookingObservation;
};

export type BookingCancelledEvent = TaskEventBase & {
  kind: "booking_cancelled";
  operationId: string;
  operationFingerprint: string;
  dependencyFingerprint: string;
  booking: BookingObservation;
};

export type BookingModifiedEvent = TaskEventBase & {
  kind: "booking_modified";
  operationId: string;
  operationFingerprint: string;
  dependencyFingerprint: string;
  booking: BookingObservation;
};

export type OperationExecutionFailedEvent = TaskEventBase & {
  kind: "operation_execution_failed";
  operationId: string;
  operationFingerprint: string;
  dependencyFingerprint: string;
  failureCode: string;
};

export type LifecycleChangedEvent = RevisionGuardedTaskEventBase & {
  kind: "lifecycle_changed";
  lifecycle: TaskLifecycle;
};

export type TaskEvent =
  | UserSemanticEvent
  | ToolInvocationStartedEvent
  | AvailabilityObservedEvent
  | AvailabilityFailedEvent
  | QuoteObservedEvent
  | QuoteFailedEvent
  | SelectionGroundedEvent
  | OperationPreparedEvent
  | ApprovalStateChangedEvent
  | ExecutionStartedEvent
  | BookingCreatedEvent
  | BookingCancelledEvent
  | BookingModifiedEvent
  | OperationExecutionFailedEvent
  | LifecycleChangedEvent;
