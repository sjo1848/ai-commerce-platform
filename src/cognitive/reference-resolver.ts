import type {
  BookingReference,
  GroundedBookingTarget,
  GroundedSelection,
  RoomReference,
  TaskState,
} from "./contracts.js";
import type { ServerControlPayload } from "./events.js";
import { dependencyFingerprint } from "./fingerprint.js";

export type HotelGroundingInstruction = Extract<
  ServerControlPayload,
  { kind: "reference_grounded" | "booking_reference_grounded" }
>;

export type GroundingDiagnostic = {
  target: "room" | "booking";
  status: "not_requested" | "already_grounded" | "resolved" | "unresolved";
  reason?: string;
};

export type HotelReferenceResolution = {
  instructions: readonly HotelGroundingInstruction[];
  diagnostics: readonly GroundingDiagnostic[];
};

const RESOLVER_CONTRACT = "hotel_reference_resolver_v1@1";
const MAX_GROUNDED_ROOMS = 10;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function currentRoomScope(state: Readonly<TaskState>): readonly string[] | undefined {
  const availability = state.observations.availability;
  const anchor = state.control.dialogueAnchor;
  if (!availability || !anchor?.candidateScope?.length) return undefined;
  if (anchor.referencedObservationId !== availability.observationId) return undefined;
  const valid = new Set(availability.rooms.map((room) => room.roomId));
  const scope = unique(anchor.candidateScope);
  if (scope.length !== anchor.candidateScope.length || scope.some((roomId) => !valid.has(roomId))) return undefined;
  return scope;
}

function resolveRoomIds(state: Readonly<TaskState>, reference: RoomReference): readonly string[] | undefined {
  const availability = state.observations.availability;
  if (!availability) return undefined;

  if (reference.kind === "room_number") {
    const matches = availability.rooms.filter((room) => room.roomNumber === reference.value);
    return matches.length === 1 ? [matches[0]!.roomId] : undefined;
  }

  const scope = currentRoomScope(state);
  if (reference.kind === "ordinal") {
    return scope && reference.value <= scope.length ? [scope[reference.value - 1]!] : undefined;
  }
  if (reference.kind === "ordinal_set") {
    if (!scope || reference.values.some((ordinal) => ordinal > scope.length)) return undefined;
    const ids = reference.values.map((ordinal) => scope[ordinal - 1]!);
    return unique(ids).length === ids.length ? ids : undefined;
  }
  if (reference.kind === "contextual_anchor") {
    if (reference.role === "presented_set") return scope?.length ? scope : undefined;
    if (reference.role === "focused_entity") return scope?.length === 1 ? scope : undefined;
    if (reference.role === "current_selection") {
      const grounded = state.control.groundedSelection;
      return grounded && grounded.sourceObservationId === availability.observationId && grounded.roomIds.length
        ? grounded.roomIds
        : undefined;
    }
  }
  if (reference.kind === "relation") {
    if (reference.value === "both") return scope?.length === 2 ? scope : undefined;
    const grounded = state.control.groundedSelection;
    if (!scope || scope.length !== 2 || !grounded || grounded.roomIds.length !== 1) return undefined;
    const current = grounded.roomIds[0]!;
    if (!scope.includes(current)) return undefined;
    return [scope[0] === current ? scope[1]! : scope[0]!];
  }
  return undefined;
}

function bookingAnchorCandidate(state: Readonly<TaskState>): string | undefined {
  const booking = state.observations.booking;
  const anchor = state.control.dialogueAnchor;
  if (!booking || !anchor?.candidateScope || anchor.candidateScope.length !== 1) return undefined;
  if (anchor.referencedObservationId !== booking.observationId) return undefined;
  return anchor.candidateScope[0] === booking.bookingId ? booking.bookingId : undefined;
}

function resolveBookingId(state: Readonly<TaskState>, reference: BookingReference): string | undefined {
  const booking = state.observations.booking;
  if (!booking) return undefined;
  if (reference.kind === "visible_reference") return reference.value === booking.bookingId ? booking.bookingId : undefined;
  if (reference.role === "focused_entity") return bookingAnchorCandidate(state);
  if (reference.role === "current_selection") {
    const grounded = state.control.groundedBookingTarget;
    if (grounded && grounded.sourceObservationId === booking.observationId && grounded.bookingId === booking.bookingId) return booking.bookingId;
    return bookingAnchorCandidate(state);
  }
  return undefined;
}

async function roomInstruction(
  state: Readonly<TaskState>,
): Promise<{ instruction?: HotelGroundingInstruction; diagnostic: GroundingDiagnostic }> {
  const reference = state.user.requestedSelectionReference;
  if (!reference) return { diagnostic: { target: "room", status: "not_requested" } };
  const availability = state.observations.availability;
  if (!availability) return { diagnostic: { target: "room", status: "unresolved", reason: "availability_missing" } };

  const roomIds = resolveRoomIds(state, reference);
  if (!roomIds?.length || roomIds.length > MAX_GROUNDED_ROOMS) {
    return { diagnostic: { target: "room", status: "unresolved", reason: "reference_not_uniquely_resolvable" } };
  }
  const existing = state.control.groundedSelection;
  if (
    existing &&
    existing.sourceObservationId === availability.observationId &&
    existing.roomIds.length === roomIds.length &&
    existing.roomIds.every((roomId, index) => roomId === roomIds[index])
  ) return { diagnostic: { target: "room", status: "already_grounded" } };

  const usesAnchor = reference.kind !== "room_number";
  const dependencyPaths = [
    "observations.availability",
    "user.requestedSelectionReference",
    ...(usesAnchor ? ["control.dialogueAnchor"] : []),
  ] as const;
  const dependencyFingerprintValue = await dependencyFingerprint({
    resolverContract: RESOLVER_CONTRACT,
    taskId: state.taskId,
    observationId: availability.observationId,
    reference: reference as never,
    roomIds,
    ...(usesAnchor
      ? {
          anchor: {
            anchorId: state.control.dialogueAnchor?.anchorId ?? null,
            referencedObservationId: state.control.dialogueAnchor?.referencedObservationId ?? null,
            candidateScope: state.control.dialogueAnchor?.candidateScope ?? [],
          },
        }
      : {}),
  });
  const groundedSelection: GroundedSelection = {
    roomIds,
    sourceObservationId: availability.observationId,
    authority: "server",
    dependencyFingerprint: dependencyFingerprintValue,
    dependencyPaths,
  };
  return {
    instruction: { kind: "reference_grounded", groundedSelection },
    diagnostic: { target: "room", status: "resolved" },
  };
}

async function bookingInstruction(
  state: Readonly<TaskState>,
): Promise<{ instruction?: HotelGroundingInstruction; diagnostic: GroundingDiagnostic }> {
  const reference = state.user.bookingReference;
  if (!reference) return { diagnostic: { target: "booking", status: "not_requested" } };
  const booking = state.observations.booking;
  if (!booking) return { diagnostic: { target: "booking", status: "unresolved", reason: "booking_observation_missing" } };

  const bookingId = resolveBookingId(state, reference);
  if (!bookingId) return { diagnostic: { target: "booking", status: "unresolved", reason: "reference_not_uniquely_resolvable" } };
  const existing = state.control.groundedBookingTarget;
  if (existing && existing.bookingId === bookingId && existing.sourceObservationId === booking.observationId) {
    return { diagnostic: { target: "booking", status: "already_grounded" } };
  }

  const usesAnchor = reference.kind === "contextual_anchor";
  const dependencyPaths = [
    "observations.booking",
    "user.bookingReference",
    ...(usesAnchor ? ["control.dialogueAnchor"] : []),
  ] as const;
  const dependencyFingerprintValue = await dependencyFingerprint({
    resolverContract: RESOLVER_CONTRACT,
    taskId: state.taskId,
    observationId: booking.observationId,
    reference: reference as never,
    bookingId,
    ...(usesAnchor
      ? {
          anchor: {
            anchorId: state.control.dialogueAnchor?.anchorId ?? null,
            referencedObservationId: state.control.dialogueAnchor?.referencedObservationId ?? null,
            candidateScope: state.control.dialogueAnchor?.candidateScope ?? [],
          },
        }
      : {}),
  });
  const groundedBookingTarget: GroundedBookingTarget = {
    bookingId,
    sourceObservationId: booking.observationId,
    authority: "server",
    dependencyFingerprint: dependencyFingerprintValue,
    dependencyPaths,
  };
  return {
    instruction: { kind: "booking_reference_grounded", groundedBookingTarget },
    diagnostic: { target: "booking", status: "resolved" },
  };
}

/**
 * Bounded, deterministic, server-owned reference resolution. It sees current
 * TaskState only, performs no I/O/model/tool work and never mutates state.
 * Accepted grounding enters TaskState later only through ServerControlEvent -> Reducer.
 */
export async function resolveHotelReferences(state: Readonly<TaskState>): Promise<HotelReferenceResolution> {
  const room = await roomInstruction(state);
  const booking = await bookingInstruction(state);
  const instructions = [room.instruction, booking.instruction].filter(
    (instruction): instruction is HotelGroundingInstruction => instruction !== undefined,
  );
  return {
    instructions,
    diagnostics: [room.diagnostic, booking.diagnostic],
  };
}
