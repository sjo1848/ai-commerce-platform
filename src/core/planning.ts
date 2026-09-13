import { stableStringify } from "./idempotency.js";
import type { TaskDependencyKey, TaskStateV1 } from "./task-state.js";

export type HotelCapabilityId =
  | "availability"
  | "quote"
  | "reserve_single"
  | "reserve_multi"
  | "cancel_single"
  | "cancel_multi"
  | "modify";

export type CapabilityEffectClass = "read" | "write";
export type HotelRequirement =
  | "checkIn"
  | "checkOut"
  | "guests"
  | "groundedSelectionSingle"
  | "groundedSelectionMulti"
  | "groundedBookingTarget";

export type HotelCapabilityContract = {
  toolId?: string;
  effectClass: CapabilityEffectClass;
  requiredFacts: readonly HotelRequirement[];
  dependencyKeys: readonly TaskDependencyKey[];
};

export type HotelTaskDefinition = {
  id: "hotel_task_v1";
  version: "1";
  capabilities: Readonly<Record<HotelCapabilityId, HotelCapabilityContract>>;
};

export const HOTEL_TASK_DEFINITION_V1: HotelTaskDefinition = {
  id: "hotel_task_v1",
  version: "1",
  capabilities: {
    availability: {
      toolId: "hms.checkAvailability",
      effectClass: "read",
      requiredFacts: ["checkIn", "checkOut", "guests"],
      dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "requestedStay.guests"],
    },
    quote: {
      toolId: "hms.getQuote",
      effectClass: "read",
      requiredFacts: ["checkIn", "checkOut", "groundedSelectionSingle"],
      dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "groundedSelection"],
    },
    reserve_single: {
      toolId: "hms.createReservation",
      effectClass: "write",
      requiredFacts: ["checkIn", "checkOut", "groundedSelectionSingle"],
      dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "requestedRoomCount", "availability", "groundedSelection", "operationIntent"],
    },
    reserve_multi: {
      toolId: "hms.createMultiReservation",
      effectClass: "write",
      requiredFacts: ["checkIn", "checkOut", "groundedSelectionMulti"],
      dependencyKeys: ["requestedStay.checkIn", "requestedStay.checkOut", "requestedRoomCount", "availability", "groundedSelection", "operationIntent"],
    },
    cancel_single: {
      toolId: "hms.cancelReservation",
      effectClass: "write",
      requiredFacts: ["groundedBookingTarget"],
      dependencyKeys: ["bookingReference", "operationIntent"],
    },
    cancel_multi: {
      toolId: "hms.cancelMultiReservation",
      effectClass: "write",
      requiredFacts: ["groundedBookingTarget"],
      dependencyKeys: ["bookingReference", "operationIntent"],
    },
    modify: {
      effectClass: "write",
      requiredFacts: ["groundedBookingTarget"],
      dependencyKeys: ["bookingReference", "operationIntent"],
    },
  },
};

export type DomainCapability = {
  id: HotelCapabilityId;
  toolId: string;
  contractVersion: string;
  effectClass: CapabilityEffectClass;
  requiredFacts: readonly HotelRequirement[];
  dependencyKeys: readonly TaskDependencyKey[];
};

export type DomainCapabilities = Readonly<Partial<Record<HotelCapabilityId, DomainCapability>>>;

export function buildHotelDomainCapabilities(
  visibleToolIds: readonly string[],
  definition: HotelTaskDefinition = HOTEL_TASK_DEFINITION_V1,
): DomainCapabilities {
  const visible = new Set(visibleToolIds);
  const result: Partial<Record<HotelCapabilityId, DomainCapability>> = {};
  for (const id of Object.keys(definition.capabilities) as HotelCapabilityId[]) {
    const contract = definition.capabilities[id];
    if (!contract.toolId || !visible.has(contract.toolId)) continue;
    result[id] = {
      id,
      toolId: contract.toolId,
      effectClass: contract.effectClass,
      requiredFacts: [...contract.requiredFacts],
      dependencyKeys: [...contract.dependencyKeys],
      contractVersion: `${definition.id}@${definition.version}:${id}:${contract.toolId}`,
    };
  }
  return result;
}

export type DomainCapabilities = Readonly<Partial<Record<HotelCapabilityId, DomainCapability>>>;

export function capabilityPreconditionFingerprint(
  definition: Readonly<HotelTaskDefinition>,
  capability: Readonly<DomainCapability>,
  dependencyProjection: Readonly<Record<string, unknown>>,
(: string {
  return `dep:v1:${stableStringify({
    taskDefinition: `${definition.id}@${definition.version}`,
    capabilityId: capability.id,
    capabilityContract: capability.contractVersion,
    dependencyKeys: capability.dependencyKeys,
    dependencies: dependencyProjection,
  })}`;
}

export function hotelCapabilityDependencyProjection(
  state: Readonly<TaskStateV1>,
  capabilityId: HotelCapabilityId,
(: Readonly<Record<string, unknown>> | undefined {
  const checkIn = state.requestedStay.checkIn?.value;
  const checkOut = state.requestedStay.checkOut?.value;
  const guests = state.requestedStay.guests?.value;

  if (capabilityId === "availability") {
    if (!checkIn || !checkOut || guests === undefined) return undefined;
    return { checkIn, checkOut, guests };
  }

  if (capabilityId === "quote") {
    if (!checkIn || !checkOut || state.groundedSelection.status !== "grounded" || state.groundedSelection.roomIds.length !== 1) return undefined;
    return {
      checkIn,
      checkOut,
      roomId: state.groundedSelection.roomIds[0],
      selectionDependencyFingerprint: state.groundedSelection.dependencyFingerprint ?? null,
    };
  }

  if (capabilityId === "reserve_single" || capabilityId === "reserve_multi") {
    if (!checkIn || !checkOut || state.groundedSelection.status !== "grounded" || state.groundedSelection.roomIds.length === 0) return undefined;
    if (state.operationIntent?.status !== "active" || state.operationIntent.kind !== "reserve") return undefined;
    if (capabilityId === "reserve_single" && state.groundedSelection.roomIds.length !== 1) return undefined;
    if (capabilityId === "reserve_multi" && state.groundedSelection.roomIds.length < 2) return undefined;
    const { provenance: _provenance, ...operationIntent } = state.operationIntent;
    return {
      checkIn,
      checkOut,
      roomIds: [...state.groundedSelection.roomIds],
      requestedRoomCount: state.requestedRoomCount?.value ?? null,
      availabilityDependencyFingerprint: state.availability.dependencyFingerprint ?? null,
      selectionDependencyFingerprint: state.groundedSelection.dependencyFingerprint ?? null,
      operationIntent,
    };
  }

  // Cancellation/modification remain unavailable to the planner until the
  // server-owned grounded booking target is represented in TaskState.
  return undefined;
}

export type RetryDirective = {
  targetCapabilityId?: HotelCapabilityId;
  correlationId?: string;
};

export type ReadDirective =
  | { kind: "availability" }
  | { kind: "quote" }
  | { kind: "knowledge"; fields: readonly string[] };

export type PlanningTrigger = {
  origin: "user" | "tool" | "server";
  acceptedEventId?: string;
  correlationId?: string;
  retryDirective?: RetryDirective;
  readDirective?: ReadDirective;
  showOptionsDirective?: true;
  abortDirective?: true;
  interactionDirective?: "acknowledge" | "social" | "help";
  observationKind?:
    | "availability_observed"
    | "availability_failed"
    | "quote_observed"
    | "quote_failed"
    | "booking_created"
    | "booking_cancelled"
    | "booking_modified"
    | "operation_execution_failed";
  controlKind?:
    | "approval_required"
    | "approval_approved"
    | "approval_invalidated"
    | "execution_started"
    | "lifecycle_changed";
};

export type PlanningContext = {
  state: Readonly<TaskStateV1>;
  trigger: Readonly<PlanningTrigger>;
  taskDefinition: Readonly<HotelTaskDefinition>;
  capabilities: DomainCapabilities;
};

export type AskField =
  | "dates"
  | "check_in"
  | "check_out"
  | "guests"
  | "selection"
  | "booking_reference"
  | "retry_target";

export type PresentationContext = {
  kind: "availability_options";
  observationRevision: number;
  roomIds: readonly string[];
};

export type DialogueAnchorSpec = {
  kind: "dates" | "check_out" | "guests" | "selection" | "booking_reference" | "other_bounded";
  candidateRoomIds?: readonly string[];
  referencedObservationRevision?: number;
};

export type GroundedReference =
  | { kind: "availability"; observationRevision: number; roomIds: readonly string[] }
  | { kind: "selection"; roomIds: readonly string[] }
  | { kind: "quote"; observationRevision: number; roomIds: readonly string[] }
  | { kind: "booking"; bookingId: string }
  | { kind: "operation"; operationId: string };

export type NextStep =
  | {
      kind: "ASK";
      field: AskField;
      reason: string;
      presentationContext?: PresentationContext;
      dialogueAnchorSpec: DialogueAnchorSpec;
    }
  | {
      kind: "CALL_TOOL";
      capabilityId: HotelCapabilityId;
      groundedInput: Readonly<Record<string, unknown>>;
      preconditionFingerprint: string;
      correlationIntent: string;
      effectClass: CapabilityEffectClass;
    }
  | {
      kind: "RESPOND";
      responseIntent: string;
      groundedReferences: readonly GroundedReference[];
    }
  | {
      kind: "WAIT";
      reason: "tool_pending" | "approval_pending" | "external_event";
      correlationId?: string;
    }
  | {
      kind: "COMPLETE";
      completionReason: string;
      responseIntent: string;
      groundedReferences: readonly GroundedReference[];
    }
  | {
      kind: "DEGRADE";
      reasonCode: string;
      recoverable: boolean;
      responseIntent: string;
    };

export interface DeterministicPlanner {
  plan(context: PlanningContext): NextStep;
}
