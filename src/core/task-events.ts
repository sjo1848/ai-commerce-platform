import type {
  AvailabilityCandidate,
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

export type SelectionGroundedEvent = RevisionGuardedTaskEventBase & {
  kind: "selection_grounded";
  roomIds: readonly string[];
  basedOnAvailabilityRevision: number;
  dependencyFingerprint: DependencyFingerprint;
  dependencyKeys: readonly TaskDependencyKey[];
};

export type OperationPreparedEvent = RevisionGuardedTaskEventBase & {
  kind: "operation_prepared";
  operation: PreparedOperation;
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
  | SelectionGroundedEvent
  | OperationPreparedEvent
  | LifecycleChangedEvent;
