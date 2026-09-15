import type { ConversationIntent, ConversationState } from "../core/conversation-state.js";
import type {
  AvailabilityObservation,
  BookingObservation,
  RequestedGoal,
  TaskState,
} from "./contracts.js";
import { dependencyFingerprint } from "./fingerprint.js";

function mapGoal(intent: ConversationIntent | undefined): RequestedGoal | undefined {
  if (intent === "availability" || intent === "quote" || intent === "reservation" || intent === "cancellation") return intent;
  return undefined;
}

function stateRevision(state: Readonly<ConversationState>): number {
  return Math.max(
    state.semanticMemory.revision,
    state.roomSelectionRevision ?? 0,
    state.bookingStateRevision ?? 0,
  );
}

function legacyAvailabilityObservation(state: Readonly<ConversationState>): AvailabilityObservation | undefined {
  const { checkIn, checkOut, guests } = state.stay;
  if (!checkIn || !checkOut || guests === undefined || state.availabilityRooms.length === 0) return undefined;

  const query = { checkIn, checkOut, guests };
  const rooms = state.availabilityRooms.map((room) => ({
    roomId: room.id,
    ...(room.roomNumber ? { roomNumber: room.roomNumber } : {}),
    ...(room.roomType ? { roomType: room.roomType } : {}),
    ...(room.capacity !== undefined ? { capacity: room.capacity } : {}),
  }));
  const fingerprint = dependencyFingerprint({ kind: "availability", query });
  const observationId = `legacy-availability:${dependencyFingerprint({ query, rooms })}`;
  return {
    observationId,
    status: "observed",
    source: "legacy_migration",
    query,
    rooms,
    dependencyFingerprint: fingerprint,
  };
}

function legacyBookingObservation(state: Readonly<ConversationState>): BookingObservation | undefined {
  if (!state.activeBookingId) return undefined;
  const status = state.bookingStatus ?? "unknown";
  const dependency = { kind: "booking", bookingId: state.activeBookingId };
  return {
    observationId: `legacy-booking:${dependencyFingerprint({ ...dependency, status })}`,
    status,
    source: "legacy_migration",
    bookingId: state.activeBookingId,
    dependencyFingerprint: dependencyFingerprint(dependency),
  };
}

/**
 * One-way migration adapter for ACP-3.0 entry.
 *
 * It deliberately does not infer operationIntent from legacy activeIntent:
 * goal and executable commit are separate authorities in ACP-3.0.
 * Operational snapshots are marked legacy_migration so later implementation
 * can re-observe/re-ground them without treating migration as fresh tool truth.
 */
export function conversationStateToTaskStateSeed(
  state: Readonly<ConversationState>,
  input: { taskId: string },
): TaskState {
  const requestedGoal = mapGoal(state.semanticMemory.activeIntent?.value);
  const availability = legacyAvailabilityObservation(state);
  const booking = legacyBookingObservation(state);
  const selectedRoomIds = availability
    ? state.selectedRoomIds.filter((roomId) => availability.rooms.some((room) => room.roomId === roomId))
    : [];

  const groundedSelection = availability && selectedRoomIds.length > 0
    ? {
        roomIds: selectedRoomIds,
        sourceObservationId: availability.observationId,
        dependencyFingerprint: dependencyFingerprint({
          kind: "selection",
          observationId: availability.observationId,
          roomIds: selectedRoomIds,
        }),
        authority: "legacy_migration" as const,
      }
    : undefined;

  const roomSelectionRevision = state.roomSelectionRevision;
  const bookingStateRevision = state.bookingStateRevision;

  return {
    schemaVersion: "acp-task-state-v1",
    taskId: input.taskId,
    lifecycle: "active",
    stateRevision: stateRevision(state),
    user: {
      ...(requestedGoal ? { requestedGoal } : {}),
      stay: {
        ...(state.stay.checkIn ? { checkIn: state.stay.checkIn } : {}),
        ...(state.stay.checkOut ? { checkOut: state.stay.checkOut } : {}),
        ...(state.stay.guests !== undefined ? { guests: state.stay.guests } : {}),
      },
      preferences: state.semanticMemory.preferences.map((preference) => preference.value),
      ...(state.requestedRoomCount !== undefined ? { requestedRoomCount: state.requestedRoomCount } : {}),
    },
    observations: {
      ...(availability ? { availability } : {}),
      ...(booking ? { booking } : {}),
      executionResults: [],
    },
    control: {
      ...(groundedSelection ? { groundedSelection } : {}),
    },
    provenance: {
      migratedFromConversationState: {
        semanticMemoryRevision: state.semanticMemory.revision,
        ...(roomSelectionRevision !== undefined ? { roomSelectionRevision } : {}),
        ...(bookingStateRevision !== undefined ? { bookingStateRevision } : {}),
      },
    },
  };
}
