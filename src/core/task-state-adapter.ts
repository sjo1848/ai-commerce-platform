import { CoreError } from "./errors.js";
import type { ConversationState, SemanticFactProvenance } from "./conversation-state.js";
import type { TaskFact, TaskGoal, TaskStateV1 } from "./task-state.js";

export type TaskStateProjectionIdentity = {
  taskId: string;
  sessionId: string;
  tenantId: string;
  actorId: string;
};

/**
 * Existing operational fields that cannot yet be promoted into ACP-3.0 truth
 * because ConversationState does not carry the complete dependency receipts
 * required by the new contracts. They are migration hints only.
 */
export type LegacyOperationalMigrationCandidates = {
  stay: Readonly<ConversationState["stay"]>;
  availabilityRooms: ReadonlyArray<ConversationState["availabilityRooms"][number]>;
  selectedRoomIds: readonly string[];
  requestedRoomCount?: number;
  roomOccupancy: ReadonlyArray<ConversationState["roomOccupancy"][number]>;
  activeBookingId?: string;
  bookingStatus?: string;
  semanticRevision: number;
  roomSelectionRevision?: number;
  bookingStateRevision?: number;
};

export type TaskStateMigrationProjection = {
  taskState: TaskStateV1;
  legacyOperationalCandidates: LegacyOperationalMigrationCandidates;
};

function userOwnedFact<T>(value: T | undefined, meta: SemanticFactProvenance | undefined): TaskFact<T> | undefined {
  if (value === undefined || !meta || meta.cleared) return undefined;
  if (meta.source !== "user" && meta.source !== "legacy") return undefined;
  return {
    value,
    provenance: { source: meta.source, revision: meta.revision },
  };
}

function projectGoal(state: Readonly<ConversationState>): TaskFact<TaskGoal> | undefined {
  const intent = state.semanticMemory.activeIntent;
  if (!intent || (intent.source !== "user" && intent.source !== "legacy")) return undefined;
  return {
    value: intent.value,
    provenance: { source: intent.source, revision: intent.revision },
  };
}

function assertScope(state: Readonly<ConversationState>, identity: TaskStateProjectionIdentity): void {
  const scope = state.semanticMemory.scope;
  if (!scope) return;
  if (scope.sessionId !== identity.sessionId || scope.tenantId !== identity.tenantId || scope.actorId !== identity.actorId) {
    throw new CoreError("FORBIDDEN", "Conversation semantic memory scope mismatch", 403);
  }
}

/**
 * Read-only ACP-3.0 compatibility projection.
 *
 * This intentionally carries only user/legacy-owned durable semantics into the
 * new requested namespace. Existing availability, selection and booking fields
 * are returned as migration candidates instead of being silently promoted to
 * authoritative observations without dependency fingerprints.
 */
export function projectConversationStateToTaskStateV1(
  state: Readonly<ConversationState>,
  identity: TaskStateProjectionIdentity,
): TaskStateMigrationProjection {
  assertScope(state, identity);

  const checkIn = userOwnedFact(state.stay.checkIn, state.semanticMemory.stay.checkIn);
  const checkOut = userOwnedFact(state.stay.checkOut, state.semanticMemory.stay.checkOut);
  const guests = userOwnedFact(state.stay.guests, state.semanticMemory.stay.guests);
  const requestedGoal = projectGoal(state);

  const taskState: TaskStateV1 = {
    taskId: identity.taskId,
    sessionId: identity.sessionId,
    taskType: "hotel_reservation_domain",
    lifecycle: "active",
    stateRevision: 0,
    recentEventIds: [],
    requestedStay: {
      ...(checkIn ? { checkIn } : {}),
      ...(checkOut ? { checkOut } : {}),
      ...(guests ? { guests } : {}),
    },
    preferences: state.semanticMemory.preferences
      .filter((item) => item.source === "user" || item.source === "legacy")
      .map((item) => ({
        value: item.value,
        provenance: { source: item.source, revision: item.revision },
      })),
    availability: { status: "not_queried", rooms: [], dependencyKeys: [] },
    groundedSelection: { status: "none", roomIds: [], dependencyKeys: [] },
    bookings: [],
    ...(requestedGoal ? { requestedGoal } : {}),
  };

  const legacyOperationalCandidates: LegacyOperationalMigrationCandidates = {
    stay: structuredClone(state.stay),
    availabilityRooms: state.availabilityRooms.map((room) => structuredClone(room)),
    selectedRoomIds: [...state.selectedRoomIds],
    roomOccupancy: state.roomOccupancy.map((entry) => structuredClone(entry)),
    semanticRevision: state.semanticMemory.revision,
    ...(state.requestedRoomCount !== undefined ? { requestedRoomCount: state.requestedRoomCount } : {}),
    ...(state.activeBookingId ? { activeBookingId: state.activeBookingId } : {}),
    ...(state.bookingStatus ? { bookingStatus: state.bookingStatus } : {}),
    ...(state.roomSelectionRevision !== undefined ? { roomSelectionRevision: state.roomSelectionRevision } : {}),
    ...(state.bookingStateRevision !== undefined ? { bookingStateRevision: state.bookingStateRevision } : {}),
  };

  return { taskState, legacyOperationalCandidates };
}
