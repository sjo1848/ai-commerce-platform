import { stableStringify } from "./idempotency.js";
import { operationFingerprint } from "./operation-fingerprint.js";
import {
  capabilityPreconditionFingerprint,
  hotelCapabilityDependencyProjection,
} from "./planning.js";
import type {
  DomainCapabilities,
  DomainCapability,
  HotelCapabilityId,
  HotelTaskDefinition,
  NextStep,
} from "./planning.js";
import type { PolicyDecision } from "./policy.js";
import { PolicyEngine } from "./policy.js";
import { reduceTaskState, type ReductionResult } from "./task-reducer.js";
import type { ExecutionStartedEvent, OperationPreparedEvent, ToolInvocationStartedEvent } from "./task-events.js";
import type { OperationKind, PreparedOperation, TaskStateV1 } from "./task-state.js";
import { ToolRegistry } from "./tool-registry.js";
import type { ExecutionContext, ToolExecutionMeta } from "./types.js";

export type PlannerToolCall = Extract<NextStep, { kind: "CALL_TOOL" }>;

export type PlannerToolAdmissionMeta = {
  eventId: string;
  invocationId?: string;
  operationId?: string;
  startedAt: string;
};

export type PreparedExecutionAdmissionMeta = {
  eventId: string;
};

export type ExecutorRequest = {
  toolId: string;
  input: Readonly<Record<string, unknown>>;
  meta: ToolExecutionMeta;
};

export type PlannerToolAdmissionSuccess =
  | {
      ok: true;
      kind: "read_started";
      nextState: TaskStateV1;
      event: ToolInvocationStartedEvent;
      reduction: ReductionResult;
    }
  | {
      ok: true;
      kind: "write_prepared";
      nextState: TaskStateV1;
      event: OperationPreparedEvent;
      reduction: ReductionResult;
      policyDecision: PolicyDecision;
    };

export type PreparedExecutionAdmissionSuccess = {
  ok: true;
  kind: "execution_started";
  nextState: TaskStateV1;
  event: ExecutionStartedEvent;
  reduction: ReductionResult;
  executorRequest: ExecutorRequest;
};

export type ToolAdmissionFailure = {
  ok: false;
  failureCode: string;
  nextState: TaskStateV1;
};

export type PlannerToolAdmissionResult = PlannerToolAdmissionSuccess | ToolAdmissionFailure;
export type PreparedExecutionAdmissionResult = PreparedExecutionAdmissionSuccess | ToolAdmissionFailure;

export type ToolAdmissionDependencies = {
  taskDefinition: Readonly<HotelTaskDefinition>;
  capabilities: DomainCapabilities;
  registry: ToolRegistry;
  policy: PolicyEngine;
  context: ExecutionContext;
};

function fail(state: Readonly<TaskStateV1>, failureCode: string): ToolAdmissionFailure {
  return { ok: false, failureCode, nextState: structuredClone(state) as TaskStateV1 };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scopeMatches(state: Readonly<TaskStateV1>, context: Readonly<ExecutionContext>): boolean {
  return state.sessionId === context.session.id
    && context.session.tenantId === context.tenant.id
    && context.session.actorId === context.actor.id;
}

function operationKindForCapability(capabilityId: HotelCapabilityId): OperationKind | undefined {
  if (capabilityId === "reserve_single" || capabilityId === "reserve_multi") return "reserve";
  if (capabilityId === "cancel_single" || capabilityId === "cancel_multi") return "cancel";
  if (capabilityId === "modify") return "modify";
  return undefined;
}

function expectedGroundedInput(
  state: Readonly<TaskStateV1>,
  capabilityId: HotelCapabilityId,
): Readonly<Record<string, unknown>> | undefined {
  const projection = hotelCapabilityDependencyProjection(state, capabilityId);
  if (!projection) return undefined;

  if (capabilityId === "availability") {
    return {
      checkIn: projection.checkIn,
      checkOut: projection.checkOut,
      guests: projection.guests,
    };
  }

  if (capabilityId === "quote") {
    return {
      roomId: projection.roomId,
      checkIn: projection.checkIn,
      checkOut: projection.checkOut,
    };
  }

  if (capabilityId === "reserve_single") {
    const roomIds = projection.roomIds;
    if (!Array.isArray(roomIds) || roomIds.length !== 1 || typeof roomIds[0] !== "string") return undefined;
    return {
      roomId: roomIds[0],
      checkIn: projection.checkIn,
      checkOut: projection.checkOut,
    };
  }

  if (capabilityId === "reserve_multi") {
    const roomIds = projection.roomIds;
    if (!Array.isArray(roomIds) || roomIds.length < 2 || roomIds.some((roomId) => typeof roomId !== "string")) return undefined;
    return {
      roomIds: [...roomIds],
      checkIn: projection.checkIn,
      checkOut: projection.checkOut,
    };
  }

  return undefined;
}

function currentPrecondition(
  state: Readonly<TaskStateV1>,
  definition: Readonly<HotelTaskDefinition>,
  capability: Readonly<DomainCapability>,
): string | undefined {
  const projection = hotelCapabilityDependencyProjection(state, capability.id);
  if (!projection) return undefined;
  return capabilityPreconditionFingerprint(definition, capability, projection);
}

function capabilityBinding(
  capabilityId: HotelCapabilityId,
  dependencies: ToolAdmissionDependencies,
): { capability: DomainCapability; toolId: string } | undefined {
  const capability = dependencies.capabilities[capabilityId];
  const definitionToolId = dependencies.taskDefinition.capabilities[capabilityId].toolId;
  if (!capability || !definitionToolId || capability.toolId !== definitionToolId) return undefined;
  return { capability, toolId: capability.toolId };
}

function validateToolEffect(capability: Readonly<DomainCapability>, sideEffect: string): boolean {
  return capability.effectClass === "read" ? sideEffect === "none" : sideEffect !== "none";
}

function reductionFailure(state: Readonly<TaskStateV1>, prefix: string, reduction: ReductionResult): ToolAdmissionFailure {
  return fail(state, `${prefix}_${reduction.rejectionReason ?? "UNKNOWN"}`);
}

export async function admitPlannerToolProposal(
  state: Readonly<TaskStateV1>,
  call: Readonly<PlannerToolCall>,
  dependencies: ToolAdmissionDependencies,
  meta: PlannerToolAdmissionMeta,
): Promise<PlannerToolAdmissionResult> {
  if (!scopeMatches(state, dependencies.context)) return fail(state, "TOOL_ADMISSION_SCOPE_MISMATCH");
  if (state.lifecycle !== "active") return fail(state, "TOOL_ADMISSION_TASK_NOT_ACTIVE");

  const binding = capabilityBinding(call.capabilityId, dependencies);
  if (!binding) return fail(state, "TOOL_ADMISSION_CAPABILITY_BINDING_MISMATCH");
  if (binding.capability.effectClass !== call.effectClass) return fail(state, "TOOL_ADMISSION_EFFECT_CLASS_MISMATCH");

  const precondition = currentPrecondition(state, dependencies.taskDefinition, binding.capability);
  if (!precondition) return fail(state, "TOOL_ADMISSION_PRECONDITION_UNAVAILABLE");
  if (precondition !== call.preconditionFingerprint) return fail(state, "TOOL_ADMISSION_STALE_PRECONDITION");

  const expectedInput = expectedGroundedInput(state, call.capabilityId);
  if (!expectedInput) return fail(state, "TOOL_ADMISSION_GROUNDED_INPUT_UNAVAILABLE");
  if (stableStringify(expectedInput) !== stableStringify(call.groundedInput)) {
    return fail(state, "TOOL_ADMISSION_GROUNDED_INPUT_MISMATCH");
  }

  let tool;
  try {
    tool = dependencies.registry.get(binding.toolId);
  } catch {
    return fail(state, "TOOL_ADMISSION_TOOL_NOT_REGISTERED");
  }
  if (tool.id !== binding.toolId || !validateToolEffect(binding.capability, tool.sideEffect)) {
    return fail(state, "TOOL_ADMISSION_TOOL_CONTRACT_MISMATCH");
  }

  const policyDecision = dependencies.policy.evaluate(tool, dependencies.context);
  if (policyDecision.decision === "deny") return fail(state, `TOOL_ADMISSION_POLICY_DENIED_${policyDecision.reason}`);

  const validated = tool.validateInput(call.groundedInput, dependencies.context);
  if (!validated.ok || !isRecord(validated.value)) return fail(state, "TOOL_ADMISSION_CANONICAL_INPUT_INVALID");
  const canonicalInput = structuredClone(validated.value) as Readonly<Record<string, unknown>>;

  if (binding.capability.effectClass === "read") {
    if (policyDecision.decision !== "allow") return fail(state, "TOOL_ADMISSION_READ_APPROVAL_UNSUPPORTED");
    if (!meta.invocationId) return fail(state, "TOOL_ADMISSION_INVOCATION_ID_REQUIRED");
    const event: ToolInvocationStartedEvent = {
      kind: "tool_invocation_started",
      eventId: meta.eventId,
      taskId: state.taskId,
      sessionId: state.sessionId,
      expectedStateRevision: state.stateRevision,
      invocationId: meta.invocationId,
      capabilityId: call.capabilityId,
      dependencyFingerprint: precondition,
      dependencyKeys: [...binding.capability.dependencyKeys],
      inputSnapshot: canonicalInput,
      startedAt: meta.startedAt,
    };
    const reduction = reduceTaskState(state, event);
    if (!reduction.accepted) return reductionFailure(state, "TOOL_ADMISSION_REDUCER_REJECTED", reduction);
    return { ok: true, kind: "read_started", nextState: reduction.nextState, event, reduction };
  }

  const operationType = operationKindForCapability(call.capabilityId);
  if (!operationType) return fail(state, "TOOL_ADMISSION_WRITE_OPERATION_KIND_UNSUPPORTED");
  if (!meta.operationId) return fail(state, "TOOL_ADMISSION_OPERATION_ID_REQUIRED");
  const fingerprint = await operationFingerprint(binding.toolId, canonicalInput);
  const preparedOperation: PreparedOperation = {
    operationId: meta.operationId,
    operationType,
    capabilityId: call.capabilityId,
    toolId: binding.toolId,
    operationFingerprint: fingerprint,
    dependencyFingerprint: precondition,
    dependencyKeys: [...binding.capability.dependencyKeys],
    canonicalInputSnapshot: canonicalInput,
    status: policyDecision.decision === "approval_required" ? "approval_required" : "prepared",
  };
  const event: OperationPreparedEvent = {
    kind: "operation_prepared",
    eventId: meta.eventId,
    taskId: state.taskId,
    sessionId: state.sessionId,
    expectedStateRevision: state.stateRevision,
    operation: preparedOperation,
  };
  const reduction = reduceTaskState(state, event);
  if (!reduction.accepted) return reductionFailure(state, "TOOL_ADMISSION_REDUCER_REJECTED", reduction);
  return {
    ok: true,
    kind: "write_prepared",
    nextState: reduction.nextState,
    event,
    reduction,
    policyDecision,
  };
}

export async function admitPreparedOperationExecution(
  state: Readonly<TaskStateV1>,
  dependencies: ToolAdmissionDependencies,
  meta: PreparedExecutionAdmissionMeta,
): Promise<PreparedExecutionAdmissionResult> {
  if (!scopeMatches(state, dependencies.context)) return fail(state, "EXECUTION_ADMISSION_SCOPE_MISMATCH");
  if (state.lifecycle !== "active") return fail(state, "EXECUTION_ADMISSION_TASK_NOT_ACTIVE");

  const operation = state.preparedOperation;
  if (!operation) return fail(state, "EXECUTION_ADMISSION_PREPARED_OPERATION_REQUIRED");
  if (operation.status !== "prepared" && operation.status !== "approved") {
    return fail(state, "EXECUTION_ADMISSION_PREPARED_OPERATION_NOT_EXECUTABLE");
  }

  const binding = capabilityBinding(operation.capabilityId, dependencies);
  if (!binding || binding.toolId !== operation.toolId) return fail(state, "EXECUTION_ADMISSION_OPERATION_BINDING_MISMATCH");
  if (operationKindForCapability(operation.capabilityId) !== operation.operationType) {
    return fail(state, "EXECUTION_ADMISSION_OPERATION_KIND_MISMATCH");
  }

  const precondition = currentPrecondition(state, dependencies.taskDefinition, binding.capability);
  if (!precondition || precondition !== operation.dependencyFingerprint) {
    return fail(state, "EXECUTION_ADMISSION_STALE_PRECONDITION");
  }

  const expectedInput = expectedGroundedInput(state, operation.capabilityId);
  if (!expectedInput) return fail(state, "EXECUTION_ADMISSION_GROUNDED_INPUT_UNAVAILABLE");

  let tool;
  try {
    tool = dependencies.registry.get(operation.toolId);
  } catch {
    return fail(state, "EXECUTION_ADMISSION_TOOL_NOT_REGISTERED");
  }
  if (tool.id !== operation.toolId || !validateToolEffect(binding.capability, tool.sideEffect) || tool.sideEffect === "none") {
    return fail(state, "EXECUTION_ADMISSION_TOOL_CONTRACT_MISMATCH");
  }

  const validated = tool.validateInput(expectedInput, dependencies.context);
  if (!validated.ok || !isRecord(validated.value)) return fail(state, "EXECUTION_ADMISSION_CANONICAL_INPUT_INVALID");
  const canonicalInput = structuredClone(validated.value) as Readonly<Record<string, unknown>>;
  if (stableStringify(canonicalInput) !== stableStringify(operation.canonicalInputSnapshot)) {
    return fail(state, "EXECUTION_ADMISSION_CANONICAL_INPUT_MISMATCH");
  }

  const fingerprint = await operationFingerprint(operation.toolId, canonicalInput);
  if (fingerprint !== operation.operationFingerprint) return fail(state, "EXECUTION_ADMISSION_OPERATION_FINGERPRINT_MISMATCH");

  const policyDecision = dependencies.policy.evaluate(tool, dependencies.context);
  if (policyDecision.decision === "deny") return fail(state, `EXECUTION_ADMISSION_POLICY_DENIED_${policyDecision.reason}`);
  if (policyDecision.decision === "approval_required" && operation.status !== "approved") {
    return fail(state, "EXECUTION_ADMISSION_APPROVAL_REQUIRED");
  }

  const event: ExecutionStartedEvent = {
    kind: "execution_started",
    eventId: meta.eventId,
    taskId: state.taskId,
    sessionId: state.sessionId,
    expectedStateRevision: state.stateRevision,
    operationId: operation.operationId,
    operationFingerprint: operation.operationFingerprint,
    dependencyFingerprint: operation.dependencyFingerprint,
  };
  const reduction = reduceTaskState(state, event);
  if (!reduction.accepted) return reductionFailure(state, "EXECUTION_ADMISSION_REDUCER_REJECTED", reduction);

  const requiresApproval = policyDecision.decision === "approval_required";
  return {
    ok: true,
    kind: "execution_started",
    nextState: reduction.nextState,
    event,
    reduction,
    executorRequest: {
      toolId: operation.toolId,
      input: canonicalInput,
      meta: {
        idempotencyKey: `acp3:${state.taskId}:${operation.operationId}`,
        ...(requiresApproval
          ? { humanApproved: true, approvedOperationFingerprint: operation.operationFingerprint }
          : {}),
      },
    },
  };
}
