import type { AgentCoreExecutor } from "../core/executor.js";
import { stableStringify } from "../core/idempotency.js";
import type { CoreToolAdmission, CoreToolAdmissionResult } from "../core/tool-admission.js";
import type { ExecutionContext } from "../core/types.js";
import type {
  NextStep,
  OrchestrationCycleRecord,
  PendingToolInvocation,
  PreparedOperation,
  TaskState,
} from "./contracts.js";
import type { ServerControlEvent, ServerControlPayload } from "./events.js";
import { dependencyFingerprint } from "./fingerprint.js";
import {
  hotelBindingForCapability,
  revalidateHotelToolPrecondition,
} from "./core-tool-preconditions.js";
import { reduceTaskState } from "./task-state-reducer.js";

type CallToolStep = Extract<NextStep, { kind: "CALL_TOOL" }>;

const DEFAULT_INVOCATION_LEASE_MS = 60_000;

export type HotelCoreToolIntegrationDeps = {
  admission: CoreToolAdmission;
  executor: AgentCoreExecutor;
};

export type HotelCoreToolIntegrationInput = HotelCoreToolIntegrationDeps & {
  state: Readonly<TaskState>;
  cycle: Readonly<OrchestrationCycleRecord>;
  step: CallToolStep;
  context: ExecutionContext;
  now: string;
  invocationLeaseMs?: number;
};

export type HotelCoreToolIntegrationResult =
  | {
      kind: "read_dispatched";
      state: TaskState;
      controlEvents: readonly ServerControlEvent[];
      invocation: PendingToolInvocation;
      rawResult: unknown;
    }
  | {
      kind: "read_failed";
      state: TaskState;
      controlEvents: readonly ServerControlEvent[];
      invocation: PendingToolInvocation;
      error: unknown;
    }
  | {
      kind: "write_approval_required";
      state: TaskState;
      controlEvents: readonly ServerControlEvent[];
      preparedOperation: PreparedOperation;
      policyReason: string;
    }
  | {
      kind: "write_executed";
      state: TaskState;
      controlEvents: readonly ServerControlEvent[];
      preparedOperation: PreparedOperation;
      rawResult: unknown;
    }
  | {
      kind: "write_failed";
      state: TaskState;
      controlEvents: readonly ServerControlEvent[];
      preparedOperation: PreparedOperation;
      error: unknown;
    }
  | {
      kind: "blocked";
      state: TaskState;
      reason: string;
      capabilityId: string;
    }
  | {
      kind: "stale_precondition";
      state: TaskState;
      reason: string;
      capabilityId: string;
    }
  | {
      kind: "rejected";
      state: TaskState;
      reason: string;
    };

export type PreparedOperationResumeInput = HotelCoreToolIntegrationDeps & {
  state: Readonly<TaskState>;
  context: ExecutionContext;
  now: string;
};

export type PreparedOperationResumeResult =
  | {
      kind: "executed";
      state: TaskState;
      preparedOperation: PreparedOperation;
      rawResult: unknown;
    }
  | {
      kind: "execution_failed";
      state: TaskState;
      preparedOperation: PreparedOperation;
      error: unknown;
    }
  | {
      kind: "invalidated";
      state: TaskState;
      controlEvent: ServerControlEvent;
      reason: string;
    }
  | {
      kind: "blocked";
      state: TaskState;
      reason: string;
    }
  | {
      kind: "rejected";
      state: TaskState;
      reason: string;
    };

export type PendingReadRecoveryInput = HotelCoreToolIntegrationDeps & {
  state: Readonly<TaskState>;
  context: ExecutionContext;
  now: string;
};

export type PendingReadRecoveryResult =
  | {
      kind: "redispatched";
      state: TaskState;
      controlEvents: readonly ServerControlEvent[];
      invocation: PendingToolInvocation;
      rawResult: unknown;
    }
  | {
      kind: "redispatch_failed";
      state: TaskState;
      controlEvents: readonly ServerControlEvent[];
      invocation: PendingToolInvocation;
      error: unknown;
    }
  | {
      kind: "terminal";
      state: TaskState;
      controlEvent: ServerControlEvent;
      status: "failed" | "superseded" | "expired";
      reason: string;
    }
  | {
      kind: "rejected";
      state: TaskState;
      reason: string;
    };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validNow(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function leaseExpiry(now: string, leaseMs: number): string | undefined {
  const start = Date.parse(now);
  if (!Number.isFinite(start) || !Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) return undefined;
  return new Date(start + leaseMs).toISOString();
}

function eventFor(
  state: Readonly<TaskState>,
  eventId: string,
  now: string,
  causationId: string,
  payload: ServerControlPayload,
): ServerControlEvent {
  return {
    eventId,
    kind: "server_control",
    sessionId: state.sessionId,
    taskId: state.taskId,
    expectedStateRevision: state.stateRevision,
    occurredAt: now,
    causationId,
    payload,
  };
}

function applyControl(
  state: Readonly<TaskState>,
  event: ServerControlEvent,
): { ok: true; state: TaskState } | { ok: false; reason: string } {
  const reduction = reduceTaskState(state, event);
  if (!reduction.accepted) return { ok: false, reason: `server_control_rejected:${reduction.rejection ?? "unknown"}` };
  return { ok: true, state: reduction.state };
}

async function stableScopedId(prefix: "inv" | "op", state: Readonly<TaskState>, cycleId: string, step: CallToolStep): Promise<string> {
  const fingerprint = await dependencyFingerprint({
    scope: "acp3_i6_tool_identity_v1",
    prefix,
    sessionId: state.sessionId,
    taskId: state.taskId,
    cycleId,
    capabilityId: step.capabilityId,
    preconditionFingerprint: step.preconditionFingerprint,
  });
  return `${prefix}-${fingerprint.slice("fp1:sha256:".length, "fp1:sha256:".length + 32)}`;
}

function cycleOwnsStep(cycle: Readonly<OrchestrationCycleRecord>, step: CallToolStep): boolean {
  return cycle.status === "planned" && cycle.plannedStep?.kind === "CALL_TOOL" && sameJson(cycle.plannedStep, step);
}

function admissionBlocked(admission: CoreToolAdmissionResult): string | undefined {
  if (admission.decision === "deny") return `policy_denied:${admission.reason}`;
  if (admission.decision === "invalid_input") return `core_input_rejected:${admission.message}`;
  return undefined;
}

function activePending(state: Readonly<TaskState>): boolean {
  const pending = state.control.pendingToolInvocation;
  return Boolean(pending && (pending.status === "admitted" || pending.status === "dispatched"));
}

function activePrepared(state: Readonly<TaskState>): boolean {
  const prepared = state.control.preparedOperation;
  return Boolean(prepared && prepared.status !== "invalidated");
}

async function prepareOperation(
  state: Readonly<TaskState>,
  cycle: Readonly<OrchestrationCycleRecord>,
  step: CallToolStep,
  canonicalInput: unknown,
  operationFingerprint: string,
  operationType: PreparedOperation["operationType"],
  capabilityContractIdentity: string,
): Promise<PreparedOperation | undefined> {
  if (!isRecord(canonicalInput)) return undefined;
  return {
    operationId: await stableScopedId("op", state, cycle.cycleId, step),
    operationType,
    operationFingerprint,
    capabilityId: step.capabilityId,
    capabilityContractIdentity,
    inputSnapshot: structuredClone(canonicalInput),
    status: "prepared",
    dependencyFingerprint: step.preconditionFingerprint,
    dependencyPaths: hotelBindingForCapability(step.capabilityId)?.dependencyPaths ?? [],
  };
}

/**
 * Admit and, when safe, dispatch one Planner-produced CALL_TOOL. This boundary
 * stops at the raw tool result; raw provider/HMS data is intentionally not
 * promoted into TaskState here. I7 Observation Mapper owns that transition.
 */
export async function integrateHotelPlannedToolCall(
  input: HotelCoreToolIntegrationInput,
): Promise<HotelCoreToolIntegrationResult> {
  const { state, cycle, step, context, admission, executor, now } = input;
  if (!validNow(now)) return { kind: "rejected", state: state as TaskState, reason: "invalid_time" };
  if (context.session.id !== state.sessionId) return { kind: "rejected", state: state as TaskState, reason: "session_mismatch" };
  if (!cycleOwnsStep(cycle, step)) return { kind: "rejected", state: state as TaskState, reason: "cycle_step_mismatch" };
  if (cycle.plannedAtStateRevision !== undefined && cycle.plannedAtStateRevision > state.stateRevision) {
    return { kind: "rejected", state: state as TaskState, reason: "future_planned_revision" };
  }

  const precondition = await revalidateHotelToolPrecondition(state, step);
  if (!precondition.ok) {
    return { kind: "stale_precondition", state: state as TaskState, reason: precondition.reason, capabilityId: step.capabilityId };
  }

  if (step.effectClass === "read" && activePending(state)) {
    return { kind: "rejected", state: state as TaskState, reason: "active_invocation_exists" };
  }
  if (step.effectClass === "write" && activePrepared(state)) {
    return { kind: "rejected", state: state as TaskState, reason: "active_prepared_operation_exists" };
  }

  let coreAdmission: CoreToolAdmissionResult;
  try {
    coreAdmission = await admission.admit(step.capabilityId, step.groundedInput, context);
  } catch (error) {
    return { kind: "rejected", state: state as TaskState, reason: error instanceof Error ? `core_admission_error:${error.message}` : "core_admission_error" };
  }

  const blocked = admissionBlocked(coreAdmission);
  if (blocked) {
    return { kind: "blocked", state: state as TaskState, reason: blocked, capabilityId: step.capabilityId };
  }

  if (step.effectClass === "read") {
    if (coreAdmission.decision === "approval_required") {
      return { kind: "blocked", state: state as TaskState, reason: "read_approval_required_not_supported_v1", capabilityId: step.capabilityId };
    }
    if (coreAdmission.sideEffect !== "none" || !isRecord(coreAdmission.canonicalInput)) {
      return { kind: "rejected", state: state as TaskState, reason: "read_tool_contract_mismatch" };
    }

    const expiry = leaseExpiry(now, input.invocationLeaseMs ?? DEFAULT_INVOCATION_LEASE_MS);
    if (!expiry) return { kind: "rejected", state: state as TaskState, reason: "invalid_invocation_lease" };
    const invocation: PendingToolInvocation = {
      invocationId: await stableScopedId("inv", state, cycle.cycleId, step),
      capabilityId: step.capabilityId,
      status: "admitted",
      inputSnapshot: structuredClone(coreAdmission.canonicalInput),
      admittedAt: now,
      leaseExpiresAt: expiry,
      dependencyFingerprint: step.preconditionFingerprint,
      dependencyPaths: precondition.binding.dependencyPaths,
    };

    const recordedEvent = eventFor(
      state,
      `i6:${invocation.invocationId}:recorded`,
      now,
      cycle.acceptedEventId,
      { kind: "invocation_recorded", invocation },
    );
    const recorded = applyControl(state, recordedEvent);
    if (!recorded.ok) return { kind: "rejected", state: state as TaskState, reason: recorded.reason };

    const dispatchedEvent = eventFor(
      recorded.state,
      `i6:${invocation.invocationId}:dispatched`,
      now,
      recordedEvent.eventId,
      { kind: "invocation_dispatched", invocationId: invocation.invocationId, startedAt: now, dispatchCorrelationId: invocation.invocationId },
    );
    const dispatched = applyControl(recorded.state, dispatchedEvent);
    if (!dispatched.ok) return { kind: "rejected", state: recorded.state, reason: dispatched.reason };
    const dispatchedInvocation = dispatched.state.control.pendingToolInvocation;
    if (!dispatchedInvocation) return { kind: "rejected", state: dispatched.state, reason: "invocation_missing_after_dispatch" };

    try {
      const rawResult = await executor.execute(step.capabilityId, coreAdmission.canonicalInput, context, {});
      return {
        kind: "read_dispatched",
        state: dispatched.state,
        controlEvents: [recordedEvent, dispatchedEvent],
        invocation: dispatchedInvocation,
        rawResult,
      };
    } catch (error) {
      return {
        kind: "read_failed",
        state: dispatched.state,
        controlEvents: [recordedEvent, dispatchedEvent],
        invocation: dispatchedInvocation,
        error,
      };
    }
  }

  if (!precondition.operationType) {
    return { kind: "rejected", state: state as TaskState, reason: "write_operation_type_missing" };
  }
  if (coreAdmission.sideEffect === "none" || !coreAdmission.operationFingerprint) {
    return { kind: "rejected", state: state as TaskState, reason: "write_tool_contract_mismatch" };
  }

  const prepared = await prepareOperation(
    state,
    cycle,
    step,
    coreAdmission.canonicalInput,
    coreAdmission.operationFingerprint,
    precondition.operationType,
    precondition.binding.contractIdentity,
  );
  if (!prepared || prepared.dependencyPaths.length === 0) {
    return { kind: "rejected", state: state as TaskState, reason: "prepared_operation_shape_invalid" };
  }

  const preparedEvent = eventFor(
    state,
    `i6:${prepared.operationId}:prepared`,
    now,
    cycle.acceptedEventId,
    { kind: "prepared_operation_recorded", operation: prepared },
  );
  const preparedReduction = applyControl(state, preparedEvent);
  if (!preparedReduction.ok) return { kind: "rejected", state: state as TaskState, reason: preparedReduction.reason };

  if (coreAdmission.decision === "approval_required") {
    const approvalEvent = eventFor(
      preparedReduction.state,
      `i6:${prepared.operationId}:approval_required`,
      now,
      preparedEvent.eventId,
      {
        kind: "prepared_operation_status_changed",
        operationId: prepared.operationId,
        operationFingerprint: prepared.operationFingerprint,
        status: "approval_required",
      },
    );
    const approvalReduction = applyControl(preparedReduction.state, approvalEvent);
    if (!approvalReduction.ok) return { kind: "rejected", state: preparedReduction.state, reason: approvalReduction.reason };
    const approvalPrepared = approvalReduction.state.control.preparedOperation;
    if (!approvalPrepared) return { kind: "rejected", state: approvalReduction.state, reason: "prepared_operation_missing_after_approval_gate" };
    return {
      kind: "write_approval_required",
      state: approvalReduction.state,
      controlEvents: [preparedEvent, approvalEvent],
      preparedOperation: approvalPrepared,
      policyReason: coreAdmission.reason,
    };
  }

  const finalPrecondition = await revalidateHotelToolPrecondition(preparedReduction.state, step);
  if (!finalPrecondition.ok || finalPrecondition.expectedFingerprint !== prepared.dependencyFingerprint) {
    return { kind: "stale_precondition", state: preparedReduction.state, reason: finalPrecondition.ok ? "prepared_dependency_mismatch" : finalPrecondition.reason, capabilityId: step.capabilityId };
  }

  try {
    const rawResult = await executor.execute(
      step.capabilityId,
      prepared.inputSnapshot,
      context,
      { idempotencyKey: prepared.operationId },
    );
    return {
      kind: "write_executed",
      state: preparedReduction.state,
      controlEvents: [preparedEvent],
      preparedOperation: prepared,
      rawResult,
    };
  } catch (error) {
    return {
      kind: "write_failed",
      state: preparedReduction.state,
      controlEvents: [preparedEvent],
      preparedOperation: prepared,
      error,
    };
  }
}

function syntheticPreparedStep(operation: PreparedOperation): CallToolStep | undefined {
  if (!operation.capabilityId || !operation.capabilityContractIdentity) return undefined;
  const binding = hotelBindingForCapability(operation.capabilityId);
  if (!binding || binding.contractIdentity !== operation.capabilityContractIdentity || binding.effectClass !== "write") return undefined;
  return {
    kind: "CALL_TOOL",
    capabilityId: operation.capabilityId,
    groundedInput: operation.inputSnapshot,
    preconditionFingerprint: operation.dependencyFingerprint,
    correlationIntent: "resume_prepared_operation",
    effectClass: "write",
  };
}

async function invalidatePrepared(
  state: Readonly<TaskState>,
  operation: PreparedOperation,
  now: string,
  reason: string,
): Promise<PreparedOperationResumeResult> {
  const event = eventFor(
    state,
    `i6:${operation.operationId}:invalidated:${reason}`,
    now,
    operation.operationId,
    {
      kind: "prepared_operation_status_changed",
      operationId: operation.operationId,
      operationFingerprint: operation.operationFingerprint,
      status: "invalidated",
    },
  );
  const reduction = applyControl(state, event);
  if (!reduction.ok) return { kind: "rejected", state: state as TaskState, reason: reduction.reason };
  return { kind: "invalidated", state: reduction.state, controlEvent: event, reason };
}

/** Execute only an already-approved exact PreparedOperation. No Planner call occurs. */
export async function resumeApprovedHotelOperation(
  input: PreparedOperationResumeInput,
): Promise<PreparedOperationResumeResult> {
  const { state, context, admission, executor, now } = input;
  if (!validNow(now)) return { kind: "rejected", state: state as TaskState, reason: "invalid_time" };
  if (context.session.id !== state.sessionId) return { kind: "rejected", state: state as TaskState, reason: "session_mismatch" };
  const operation = state.control.preparedOperation;
  if (!operation) return { kind: "rejected", state: state as TaskState, reason: "prepared_operation_missing" };
  if (operation.status !== "approved") return { kind: "rejected", state: state as TaskState, reason: `prepared_operation_not_approved:${operation.status}` };

  const step = syntheticPreparedStep(operation);
  if (!step) return invalidatePrepared(state, operation, now, "prepared_capability_identity_missing_or_stale");
  const precondition = await revalidateHotelToolPrecondition(state, step);
  if (!precondition.ok || precondition.expectedFingerprint !== operation.dependencyFingerprint) {
    return invalidatePrepared(state, operation, now, precondition.ok ? "prepared_dependency_mismatch" : precondition.reason);
  }

  let coreAdmission: CoreToolAdmissionResult;
  try {
    coreAdmission = await admission.admit(step.capabilityId, operation.inputSnapshot, context);
  } catch (error) {
    return { kind: "blocked", state: state as TaskState, reason: error instanceof Error ? `core_admission_error:${error.message}` : "core_admission_error" };
  }
  const blocked = admissionBlocked(coreAdmission);
  if (blocked) return { kind: "blocked", state: state as TaskState, reason: blocked };
  if (coreAdmission.sideEffect === "none" || !coreAdmission.operationFingerprint) {
    return invalidatePrepared(state, operation, now, "prepared_tool_effect_changed");
  }
  if (coreAdmission.operationFingerprint !== operation.operationFingerprint) {
    return invalidatePrepared(state, operation, now, "prepared_operation_fingerprint_mismatch");
  }
  if (stableStringify(coreAdmission.canonicalInput) !== stableStringify(operation.inputSnapshot)) {
    return invalidatePrepared(state, operation, now, "prepared_canonical_input_changed");
  }

  try {
    const rawResult = await executor.execute(
      step.capabilityId,
      operation.inputSnapshot,
      context,
      {
        idempotencyKey: operation.operationId,
        humanApproved: true,
        approvedOperationFingerprint: operation.operationFingerprint,
      },
    );
    return { kind: "executed", state: state as TaskState, preparedOperation: operation, rawResult };
  } catch (error) {
    return { kind: "execution_failed", state: state as TaskState, preparedOperation: operation, error };
  }
}

function pendingSyntheticStep(invocation: PendingToolInvocation): CallToolStep {
  return {
    kind: "CALL_TOOL",
    capabilityId: invocation.capabilityId,
    groundedInput: invocation.inputSnapshot,
    preconditionFingerprint: invocation.dependencyFingerprint,
    correlationIntent: "recover_pending_read",
    effectClass: "read",
  };
}

async function terminalizeInvocation(
  state: Readonly<TaskState>,
  invocation: PendingToolInvocation,
  now: string,
  status: "failed" | "superseded" | "expired",
  reason: string,
): Promise<PendingReadRecoveryResult> {
  const event = eventFor(
    state,
    `i6:${invocation.invocationId}:terminal:${status}:${reason}`,
    now,
    invocation.invocationId,
    { kind: "invocation_terminal", invocationId: invocation.invocationId, status, terminalCorrelationId: reason },
  );
  const reduction = applyControl(state, event);
  if (!reduction.ok) return { kind: "rejected", state: state as TaskState, reason: reduction.reason };
  return { kind: "terminal", state: reduction.state, controlEvent: event, status, reason };
}

/**
 * Bounded recovery for an admitted/dispatched read invocation. Reads are the
 * only invocations recoverable by redispatch here because their tool contract
 * is side-effect-free. Writes recover through PreparedOperation + idempotency.
 */
export async function recoverPendingHotelRead(
  input: PendingReadRecoveryInput,
): Promise<PendingReadRecoveryResult> {
  const { state, context, admission, executor, now } = input;
  if (!validNow(now)) return { kind: "rejected", state: state as TaskState, reason: "invalid_time" };
  if (context.session.id !== state.sessionId) return { kind: "rejected", state: state as TaskState, reason: "session_mismatch" };
  const invocation = state.control.pendingToolInvocation;
  if (!invocation || (invocation.status !== "admitted" && invocation.status !== "dispatched")) {
    return { kind: "rejected", state: state as TaskState, reason: "recoverable_invocation_missing" };
  }
  if (Date.parse(now) >= Date.parse(invocation.leaseExpiresAt)) {
    return terminalizeInvocation(state, invocation, now, "expired", "lease_expired");
  }

  const step = pendingSyntheticStep(invocation);
  const precondition = await revalidateHotelToolPrecondition(state, step);
  if (!precondition.ok || precondition.binding.effectClass !== "read") {
    return terminalizeInvocation(state, invocation, now, "superseded", precondition.ok ? "tool_effect_changed" : precondition.reason);
  }

  let coreAdmission: CoreToolAdmissionResult;
  try {
    coreAdmission = await admission.admit(invocation.capabilityId, invocation.inputSnapshot, context);
  } catch {
    return terminalizeInvocation(state, invocation, now, "failed", "core_admission_error");
  }
  if (coreAdmission.decision !== "allow" || coreAdmission.sideEffect !== "none" || !isRecord(coreAdmission.canonicalInput)) {
    return terminalizeInvocation(state, invocation, now, "failed", coreAdmission.decision === "deny" ? `policy_denied_${coreAdmission.reason}` : "read_recovery_admission_blocked");
  }

  let working = state as TaskState;
  const controlEvents: ServerControlEvent[] = [];
  if (invocation.status === "admitted") {
    const dispatchedEvent = eventFor(
      working,
      `i6:${invocation.invocationId}:recovery_dispatched`,
      now,
      invocation.invocationId,
      { kind: "invocation_dispatched", invocationId: invocation.invocationId, startedAt: now, dispatchCorrelationId: invocation.invocationId },
    );
    const reduction = applyControl(working, dispatchedEvent);
    if (!reduction.ok) return { kind: "rejected", state: working, reason: reduction.reason };
    working = reduction.state;
    controlEvents.push(dispatchedEvent);
  }

  const currentInvocation = working.control.pendingToolInvocation;
  if (!currentInvocation) return { kind: "rejected", state: working, reason: "invocation_missing_before_redispatch" };
  try {
    const rawResult = await executor.execute(invocation.capabilityId, coreAdmission.canonicalInput, context, {});
    return { kind: "redispatched", state: working, controlEvents, invocation: currentInvocation, rawResult };
  } catch (error) {
    return { kind: "redispatch_failed", state: working, controlEvents, invocation: currentInvocation, error };
  }
}
