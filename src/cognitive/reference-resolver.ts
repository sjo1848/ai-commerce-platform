import type {
  BookingReference,
  DependencyPath,
  DialogueAnchor,
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

const RESOLVER_CONTRACT = "hotel_reference_resolver_v1@2";
const MAX_GROUNDED_ROOMS = 10;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validAnchorScope(anchor: Readonly<DialogueAnchor>, allowedIds: ReadonlySet<string>, observationId: string): readonly string[] | undefined {
  if (!Array.isArray(anchor.candidateScope) || anchor.candidateScope.length === 0 || anchor.referencedObservationId !== observationId) return undefined;
  if (anchor.candidateScope.some((candidateId) => !nonEmptyString(candidateId))) return undefined;
  const scope = unique(anchor.candidateScope);
  if (scope.length !== anchor.candidateScope.length || scope.some((candidateId) => !allowedIds.has(candidateId))) return undefined;
  if (anchor.focusedCandidate !== undefined && (!nonEmptyString(anchor.focusedCandidate) || !scope.includes(anchor.focusedCandidate))) return undefined;
  if (anchor.selectedCandidates !== undefined) {
    if (!Array.isArray(anchor.selectedCandidates) || anchor.selectedCandidates.length === 0 || anchor.selectedCandidates.some((candidateId) => !nonEmptyString(candidateId))) return undefined;
    const selected = unique(anchor.selectedCandidates);
    if (selected.length !== anchor.selectedCandidates.length || selected.some((candidateId) => !scope.includes(candidateId))) return undefined;
  }
  return scope;
}

function currentRoomScope(state: Readonly<TaskState>): readonly string[] | undefined {
  const availability = state.observations.availability;
  const anchor = state.control.dialogueAnchor;
  if (!availability || !anchor) return undefined;
  return validAnchorScope(anchor, new Set(availability.rooms.map((room) => room.roomId)), availability.observationId);
}

function roomAnchorFocus(state: Readonly<TaskState>, scope: readonly string[]): string | undefined {
  const focus = state.control.dialogueAnchor?.focusedCandidate;
  return nonEmptyString(focus) && scope.includes(focus) ? focus : undefined;
}

function roomAnchorSelection(state: Readonly<TaskState>, scope: readonly string[]): readonly string[] | undefined {
  const selected = state.control.dialogueAnchor?.selectedCandidates;
  if (!Array.isArray(selected) || selected.length === 0 || selected.some((candidateId) => !nonEmptyString(candidateId) || !scope.includes(candidateId))) return undefined;
  return selected;
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
    if (!scope) return undefined;
    if (reference.role === "presented_set") return scope;
    if (reference.role === "focused_entity") {
      const focused = roomAnchorFocus(state, scope);
      return focused ? [focused] : undefined;
    }
    return roomAnchorSelection(state, scope);
  }
  if (reference.kind === "relation") {
    if (!scope) return undefined;
    if (reference.value === "both") return scope.length === 2 ? scope : undefined;
    const selected = roomAnchorSelection(state, scope);
    if (scope.length !== 2 || !selected || selected.length !== 1) return undefined;
    const current = selected[0]!;
    return [scope[0] === current ? scope[1]! : scope[0]!];
  }
  return undefined;
}

function currentBookingScope(state: Readonly<TaskState>): readonly string[] | undefined {
  const booking = state.observations.booking;
  const anchor = state.control.dialogueAnchor;
  if (!booking || !anchor) return undefined;
  return validAnchorScope(anchor, new Set([booking.bookingId]), booking.observationId);
}

function resolveBookingId(state: Readonly<TaskState>, reference: BookingReference): string | undefined {
  const booking = state.observations.booking;
  if (!booking) return undefined;
  if (reference.kind === "visible_reference") return reference.value === booking.bookingId ? booking.bookingId : undefined;

  const scope = currentBookingScope(state);
  if (!scope) return undefined;
  const anchor = state.control.dialogueAnchor;
  if (reference.role === "focused_entity") {
    return anchor && nonEmptyString(anchor.focusedCandidate) && anchor.focusedCandidate === booking.bookingId ? booking.bookingId : undefined;
  }
  return anchor && Array.isArray(anchor.selectedCandidates) && anchor.selectedCandidates.length === 1 && anchor.selectedCandidates[0] === booking.bookingId
    ? booking.bookingId
    : undefined;
}

function anchorFingerprintProjection(anchor: Readonly<DialogueAnchor> | undefined) {
  return {
    anchorId: anchor?.anchorId ?? null,
    referencedObservationId: anchor?.referencedObservationId ?? null,
    candidateScope: Array.isArray(anchor?.candidateScope) ? anchor.candidateScope : [],
    focusedCandidate: nonEmptyString(anchor?.focusedCandidate) ? anchor.focusedCandidate : null,
    selectedCandidates: Array.isArray(anchor?.selectedCandidates) ? anchor.selectedCandidates : [],
  };
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
  const dependencyPaths: DependencyPath[] = [
    "observations.availability",
    "user.requestedSelectionReference",
  ];
  if (usesAnchor) dependencyPaths.push("control.dialogueAnchor");
  const dependencyFingerprintValue = await dependencyFingerprint({
    resolverContract: RESOLVER_CONTRACT,
    taskId: state.taskId,
    observationId: availability.observationId,
    reference: reference as never,
    roomIds,
    ...(usesAnchor ? { anchor: anchorFingerprintProjection(state.control.dialogueAnchor) } : {}),
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
  const dependencyPaths: DependencyPath[] = [
    "observations.booking",
    "user.bookingReference",
  ];
  if (usesAnchor) dependencyPaths.push("control.dialogueAnchor");
  const dependencyFingerprintValue = await dependencyFingerprint({
    resolverContract: RESOLVER_CONTRACT,
    taskId: state.taskId,
    observationId: booking.observationId,
    reference: reference as never,
    bookingId,
    ...(usesAnchor ? { anchor: anchorFingerprintProjection(state.control.dialogueAnchor) } : {}),
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
