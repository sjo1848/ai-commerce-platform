import type { ConversationIntent, ConversationState, SemanticFactProvenance } from "../core/conversation-state.js";
import type {
  AvailabilityCandidate,
  RequestedGoal,
  TaskStateMigrationSeed,
} from "./contracts.js";

function mapGoal(state: Readonly<ConversationState>): RequestedGoal | undefined {
  const intent = state.semanticMemory.activeIntent;
  if (!intent || (intent.source !== "user" && intent.source !== "legacy")) return undefined;
  const value: ConversationIntent = intent.value;
  if (value === "availability" || value === "quote" || value === "reservation" || value === "cancellation") return value;
  return undefined;
}

function isRequestedFact(meta: SemanticFactProvenance | undefined): boolean {
  return Boolean(meta && !meta.cleared && (meta.source === "user" || meta.source === "legacy"));
}

function requestedStay(state: Readonly<ConversationState>): { checkIn?: string; checkOut?: string; guests?: number } {
  const result: { checkIn?: string; checkOut?: string; guests?: number } = {};
  if (state.stay.checkIn && isRequestedFact(state.semanticMemory.stay.checkIn)) result.checkIn = state.stay.checkIn;
  if (state.stay.checkOut && isRequestedFact(state.semanticMemory.stay.checkOut)) result.checkOut = state.stay.checkOut;
  if (state.stay.guests !== undefined && isRequestedFact(state.semanticMemory.stay.guests)) result.guests = state.stay.guests;
  return result;
}

function legacyAvailabilityRooms(state: Readonly<ConversationState>): AvailabilityCandidate[] {
  return state.availabilityRooms.map((room) => ({
    roomId: room.id,
    ...(room.roomNumber ? { roomNumber: room.roomNumber } : {}),
    ...(room.roomType ? { roomType: room.roomType } : {}),
    ...(room.capacity !== undefined ? { capacity: room.capacity } : {}),
  }));
}

/**
 * One-way migration adapter for ACP-3.0 entry.
 *
 * Only user/legacy-provenanced requested semantics enter TaskState. Operational
 * compatibility data is returned OUTSIDE TaskState so it cannot accidentally
 * satisfy Planner/Core truth requirements. A later migration stage may inspect
 * legacyCompatibility to decide what needs fresh observation/grounding.
 */
export function conversationStateToTaskStateSeed(
  state: Readonly<ConversationState>,
  input: { taskId: string },
): TaskStateMigrationSeed {
  const requestedGoal = mapGoal(state);
  const roomSelectionRevision = state.roomSelectionRevision;
  const bookingStateRevision = state.bookingStateRevision;

  return {
    taskState: {
      schemaVersion: "acp-task-state-v1",
      taskId: input.taskId,
      lifecycle: "active",
      // ACP-3.0 starts a fresh revision domain. Legacy revisions remain provenance,
      // not a global semantic freshness counter for the new state engine.
      stateRevision: 0,
      user: {
        ...(requestedGoal ? { requestedGoal } : {}),
        stay: requestedStay(state),
        preferences: state.semanticMemory.preferences
          .filter((preference) => preference.source === "user" || preference.source === "legacy")
          .map((preference) => preference.value),
      },
      observations: { executionResults: [] },
      control: {},
      provenance: {
        migratedFromConversationState: {
          semanticMemoryRevision: state.semanticMemory.revision,
          ...(roomSelectionRevision !== undefined ? { roomSelectionRevision } : {}),
          ...(bookingStateRevision !== undefined ? { bookingStateRevision } : {}),
        },
      },
    },
    legacyCompatibility: {
      stay: {
        ...(state.stay.checkIn ? { checkIn: state.stay.checkIn } : {}),
        ...(state.stay.checkOut ? { checkOut: state.stay.checkOut } : {}),
        ...(state.stay.guests !== undefined ? { guests: state.stay.guests } : {}),
      },
      availabilityRooms: legacyAvailabilityRooms(state),
      selectedRoomIds: [...state.selectedRoomIds],
      ...(state.requestedRoomCount !== undefined ? { requestedRoomCount: state.requestedRoomCount } : {}),
      roomOccupancy: state.roomOccupancy.map((entry) => ({ ...entry })),
      ...(state.activeBookingId ? { activeBookingId: state.activeBookingId } : {}),
      ...(state.bookingStatus ? { bookingStatus: state.bookingStatus } : {}),
    },
  };
}
