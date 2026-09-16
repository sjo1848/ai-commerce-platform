import type { NextStep, OperationIntent, TaskState } from "./contracts.js";
import { dependencyFingerprint, type DependencyValue } from "./fingerprint.js";
import {
  HOTEL_TASK_DEFINITION_V1,
  type HotelCapabilityBinding,
} from "./hotel-task-definition.js";

type CallToolStep = Extract<NextStep, { kind: "CALL_TOOL" }>;
type DependencyProjection = { readonly [key: string]: DependencyValue | undefined };

export type HotelToolPreconditionResult =
  | {
      ok: true;
      binding: HotelCapabilityBinding;
      expectedFingerprint: string;
      operationType?: OperationIntent;
    }
  | {
      ok: false;
      reason:
        | "unknown_capability"
        | "effect_class_mismatch"
        | "input_state_mismatch"
        | "unsupported_capability"
        | "precondition_fingerprint_mismatch";
    };

function record(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return value;
}

function stringField(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integerField(input: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = input[key];
  return Number.isInteger(value) ? Number(value) : undefined;
}

function stringArrayField(input: Readonly<Record<string, unknown>>, key: string): readonly string[] | undefined {
  const value = input[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) return undefined;
  return value as readonly string[];
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function hotelBindingForCapability(capabilityId: string): HotelCapabilityBinding | undefined {
  return Object.values(HOTEL_TASK_DEFINITION_V1.bindings).find((binding) => binding.capabilityId === capabilityId);
}

function projectionFor(
  state: Readonly<TaskState>,
  step: CallToolStep,
  binding: HotelCapabilityBinding,
): { projection: DependencyProjection; operationType?: OperationIntent } | undefined {
  const input = record(step.groundedInput);

  if (binding.key === "availability") {
    const checkIn = stringField(input, "checkIn");
    const checkOut = stringField(input, "checkOut");
    const guests = integerField(input, "guests");
    if (
      !checkIn || !checkOut || guests === undefined ||
      state.user.stay.checkIn !== checkIn ||
      state.user.stay.checkOut !== checkOut ||
      state.user.stay.guests !== guests
    ) return undefined;
    return {
      projection: {
        lifecycle: state.lifecycle,
        checkIn,
        checkOut,
        guests,
      },
    };
  }

  if (binding.key === "quote") {
    const selection = state.control.groundedSelection;
    const roomId = stringField(input, "roomId");
    const checkIn = stringField(input, "checkIn");
    const checkOut = stringField(input, "checkOut");
    if (
      !selection || selection.roomIds.length !== 1 || !roomId || !checkIn || !checkOut ||
      selection.roomIds[0] !== roomId ||
      state.user.stay.checkIn !== checkIn ||
      state.user.stay.checkOut !== checkOut
    ) return undefined;
    return {
      projection: {
        lifecycle: state.lifecycle,
        roomId,
        checkIn,
        checkOut,
        groundedSelectionFingerprint: selection.dependencyFingerprint,
      },
    };
  }

  if (binding.key === "reserve_single") {
    const selection = state.control.groundedSelection;
    const roomId = stringField(input, "roomId");
    const checkIn = stringField(input, "checkIn");
    const checkOut = stringField(input, "checkOut");
    if (
      state.user.operationIntent !== "reserve" || !selection || selection.roomIds.length !== 1 ||
      !roomId || selection.roomIds[0] !== roomId || !checkIn || !checkOut ||
      state.user.stay.checkIn !== checkIn || state.user.stay.checkOut !== checkOut
    ) return undefined;
    return {
      projection: {
        lifecycle: state.lifecycle,
        operationIntent: "reserve",
        checkIn,
        checkOut,
        roomIds: [roomId],
        groundedSelectionFingerprint: selection.dependencyFingerprint,
      },
      operationType: "reserve",
    };
  }

  if (binding.key === "reserve_multi") {
    const selection = state.control.groundedSelection;
    const roomIds = stringArrayField(input, "roomIds");
    const checkIn = stringField(input, "checkIn");
    const checkOut = stringField(input, "checkOut");
    if (
      state.user.operationIntent !== "reserve" || !selection || !roomIds || roomIds.length < 2 ||
      !sameStrings(selection.roomIds, roomIds) || !checkIn || !checkOut ||
      state.user.stay.checkIn !== checkIn || state.user.stay.checkOut !== checkOut
    ) return undefined;
    return {
      projection: {
        lifecycle: state.lifecycle,
        operationIntent: "reserve",
        checkIn,
        checkOut,
        roomIds,
        groundedSelectionFingerprint: selection.dependencyFingerprint,
      },
      operationType: "reserve",
    };
  }

  if (binding.key === "cancel_single") {
    const target = state.control.groundedBookingTarget;
    const bookingId = stringField(input, "bookingId");
    if (state.user.operationIntent !== "cancel" || !target || !bookingId || target.bookingId !== bookingId) return undefined;
    return {
      projection: {
        lifecycle: state.lifecycle,
        operationIntent: "cancel",
        bookingId,
        groundedBookingFingerprint: target.dependencyFingerprint,
      },
      operationType: "cancel",
    };
  }

  // The v1 Planner does not currently emit cancel_multi. Rejecting it here is
  // safer than reconstructing a group target from unrelated state.
  return undefined;
}

/**
 * Independent Core-side causal revalidation for a Planner CALL_TOOL handoff.
 * It never chooses a capability and never repairs input. It only proves that
 * the already-selected bounded step still matches current authoritative state.
 */
export async function revalidateHotelToolPrecondition(
  state: Readonly<TaskState>,
  step: CallToolStep,
): Promise<HotelToolPreconditionResult> {
  const binding = hotelBindingForCapability(step.capabilityId);
  if (!binding) return { ok: false, reason: "unknown_capability" };
  if (binding.effectClass !== step.effectClass) return { ok: false, reason: "effect_class_mismatch" };

  const projected = projectionFor(state, step, binding);
  if (!projected) {
    return {
      ok: false,
      reason: binding.key === "cancel_multi" ? "unsupported_capability" : "input_state_mismatch",
    };
  }

  const expectedFingerprint = await dependencyFingerprint({
    plannerContract: "hotel_task_planner_v1@1",
    taskDefinition: HOTEL_TASK_DEFINITION_V1.contractIdentity,
    capabilityContract: binding.contractIdentity,
    capabilityId: binding.capabilityId,
    dependencyProjection: projected.projection,
  });

  if (expectedFingerprint !== step.preconditionFingerprint) {
    return { ok: false, reason: "precondition_fingerprint_mismatch" };
  }

  return {
    ok: true,
    binding,
    expectedFingerprint,
    ...(projected.operationType ? { operationType: projected.operationType } : {}),
  };
}
