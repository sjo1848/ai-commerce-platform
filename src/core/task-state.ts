export type TaskGoal = "reservation" | "availability" | "quote" | "cancellation";
export type TaskEventSource = "user" | "tool" | "server";

export type FactProvenance = {
  source: TaskEventSource;
  eventId: string;
  revision: number;
  occurredAt: string;
};

export type SemanticFact<T> = {
  value: T;
  provenance: FactProvenance;
};

export type AvailabilityRoomCandidate = {
  id: string;
  roomNumber?: string;
  roomType?: string;
  capacity?: number;
};

export type RoomOccupancy = {
  roomId: string;
  guests: number;
};

export type RoomReference =
  | { kind: "id"; value: string }
  | { kind: "number"; value: string }
  | { kind: "ordinal"; value: number }
  | { kind: "relation"; value: "both" | "other" };

export type TaskStateV1 = {
  version: 1;
  taskId: string;
  sessionId: string;
  taskType: "hotel_reservation";
  stateRevision: number;
  processedEventIds: string[];
  goal?: SemanticFact<TaskGoal>;
  stay: {
    requested: {
      checkIn?: SemanticFact<string>;
      checkOut?: SemanticFact<string>;
      guests?: SemanticFact<number>;
    };
  };
  availability: {
    status: "not_queried" | "available" | "failed";
    query?: {
      checkIn: string;
      checkOut: string;
      guests: number;
      observationRevision: number;
    };
    rooms: AvailabilityRoomCandidate[];
  };
  selection: {
    roomIds: string[];
    requestedRoomCount?: number;
    roomOccupancy: RoomOccupancy[];
    basedOnAvailabilityRevision?: number;
    needsClarification?: "selection" | "occupancy";
  };
  operationIntent: {
    reserveRequested?: true;
    cancelRequested?: true;
    revision?: number;
  };
  reservation: {
    status: "none" | "prepared" | "approval_required" | "approved" | "confirmed" | "failed";
    preparedFingerprint?: string;
    basedOnStateRevision?: number;
    bookingIds: string[];
  };
  preferences: SemanticFact<string>[];
};

export type UserSemanticEvent = {
  eventId: string;
  kind: "user.semantic";
  sessionId: string;
  taskId: string;
  expectedStateRevision: number;
  occurredAt: string;
  payload: {
    goal?: TaskGoal | null;
    stay?: {
      checkIn?: string | null;
      checkOut?: string | null;
      guests?: number | null;
    };
    selection?: {
      mode: "replace";
      references: RoomReference[];
    } | null;
    requestedRoomCount?: number | null;
    roomOccupancy?: RoomOccupancy[] | null;
    operationIntent?: {
      reserve?: boolean;
      cancel?: boolean;
    };
    preferences?: string[];
    clearPreferences?: boolean;
    ambiguity?: "dates" | "guests" | "selection" | "occupancy" | null;
  };
};

export type ToolObservationEvent = {
  eventId: string;
  kind: "tool.observation";
  sessionId: string;
  taskId: string;
  expectedStateRevision: number;
  occurredAt: string;
  payload:
    | {
        observation: "availability";
        query: { checkIn: string; checkOut: string; guests: number };
        rooms: AvailabilityRoomCandidate[];
      }
    | {
        observation: "availability_failed";
        query: { checkIn: string; checkOut: string; guests: number };
      }
    | {
        observation: "booking_created";
        bookingIds: string[];
      }
    | {
        observation: "booking_failed";
      };
};

export type ServerControlEvent = {
  eventId: string;
  kind: "server.control";
  sessionId: string;
  taskId: string;
  expectedStateRevision: number;
  occurredAt: string;
  payload:
    | { control: "operation_prepared"; operationFingerprint: string }
    | { control: "approval_required"; operationFingerprint: string }
    | { control: "approved"; operationFingerprint: string }
    | { control: "operation_invalidated" };
};

export type TaskEvent = UserSemanticEvent | ToolObservationEvent | ServerControlEvent;

export type TaskStateRejection =
  | "scope_mismatch"
  | "state_revision_conflict"
  | "invalid_semantic_event"
  | "invalid_tool_observation"
  | "stale_tool_observation"
  | "invalid_server_control";

export type TaskStateReduction = {
  state: TaskStateV1;
  accepted: boolean;
  materialChange: boolean;
  invalidations: string[];
  rejection?: TaskStateRejection;
};

export function emptyTaskState(input: { taskId: string; sessionId: string }): TaskStateV1 {
  return {
    version: 1,
    taskId: input.taskId,
    sessionId: input.sessionId,
    taskType: "hotel_reservation",
    stateRevision: 0,
    processedEventIds: [],
    stay: { requested: {} },
    availability: { status: "not_queried", rooms: [] },
    selection: { roomIds: [], roomOccupancy: [] },
    operationIntent: {},
    reservation: { status: "none", bookingIds: [] },
    preferences: [],
  };
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validGuests(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}

function validRoomCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 10;
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function semanticFact<T>(value: T, event: TaskEvent, revision: number, source: TaskEventSource): SemanticFact<T> {
  return {
    value,
    provenance: {
      source,
      eventId: event.eventId,
      revision,
      occurredAt: event.occurredAt,
    },
  };
}

function clearPreparedOperation(state: TaskStateV1, invalidations: string[], reason: string): void {
  if (state.reservation.status !== "none" || state.reservation.preparedFingerprint || state.reservation.basedOnStateRevision !== undefined) {
    state.reservation = { status: "none", bookingIds: [] };
    invalidations.push(reason);
  }
  if (state.operationIntent.reserveRequested || state.operationIntent.cancelRequested) {
    state.operationIntent = {};
    if (!invalidations.includes(reason)) invalidations.push(reason);
  }
}

function clearSelection(state: TaskStateV1, invalidations: string[], reason: string): void {
  const hadSelection = state.selection.roomIds.length > 0
    || state.selection.roomOccupancy.length > 0
    || state.selection.requestedRoomCount !== undefined
    || state.selection.basedOnAvailabilityRevision !== undefined
    || state.selection.needsClarification !== undefined;
  state.selection = { roomIds: [], roomOccupancy: [] };
  if (hadSelection) invalidations.push(reason);
  clearPreparedOperation(state, invalidations, reason);
}

function clearAvailability(state: TaskStateV1, invalidations: string[], reason: string): void {
  const hadAvailability = state.availability.status !== "not_queried"
    || state.availability.rooms.length > 0
    || state.availability.query !== undefined;
  state.availability = { status: "not_queried", rooms: [] };
  if (hadAvailability) invalidations.push(reason);
  clearSelection(state, invalidations, reason);
}

function normalizeRooms(rooms: readonly AvailabilityRoomCandidate[]): AvailabilityRoomCandidate[] | undefined {
  const result: AvailabilityRoomCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of rooms) {
    const id = candidate.id.trim();
    if (!id || seen.has(id)) return undefined;
    if (candidate.capacity !== undefined && (!Number.isInteger(candidate.capacity) || candidate.capacity < 1 || candidate.capacity > 20)) return undefined;
    seen.add(id);
    const roomNumber = candidate.roomNumber?.trim();
    const roomType = candidate.roomType?.trim();
    result.push({
      id,
      ...(roomNumber ? { roomNumber } : {}),
      ...(roomType ? { roomType } : {}),
      ...(candidate.capacity !== undefined ? { capacity: candidate.capacity } : {}),
    });
  }
  return result;
}

function requestedStay(state: TaskStateV1): { checkIn?: string; checkOut?: string; guests?: number } {
  const checkIn = state.stay.requested.checkIn?.value;
  const checkOut = state.stay.requested.checkOut?.value;
  const guests = state.stay.requested.guests?.value;
  return {
    ...(checkIn ? { checkIn } : {}),
    ...(checkOut ? { checkOut } : {}),
    ...(guests !== undefined ? { guests } : {}),
  };
}

function sameQuery(
  left: { checkIn?: string; checkOut?: string; guests?: number },
  right: { checkIn: string; checkOut: string; guests: number },
): boolean {
  return left.checkIn === right.checkIn && left.checkOut === right.checkOut && left.guests === right.guests;
}

function resolveReferences(state: TaskStateV1, references: readonly RoomReference[]): string[] | undefined {
  if (references.length === 0 || state.availability.status !== "available" || !state.availability.query) return undefined;
  const rooms = state.availability.rooms;
  const resolved: string[] = [];

  for (const reference of references) {
    if (reference.kind === "id") {
      const id = reference.value.trim();
      if (!id || !rooms.some((room) => room.id === id)) return undefined;
      resolved.push(id);
      continue;
    }
    if (reference.kind === "number") {
      const value = reference.value.trim();
      const matches = rooms.filter((room) => room.roomNumber === value);
      if (matches.length !== 1 || !matches[0]) return undefined;
      resolved.push(matches[0].id);
      continue;
    }
    if (reference.kind === "ordinal") {
      if (!Number.isInteger(reference.value) || reference.value < 1 || reference.value > rooms.length) return undefined;
      const room = rooms[reference.value - 1];
      if (!room) return undefined;
      resolved.push(room.id);
      continue;
    }
    if (reference.value === "both") {
      if (rooms.length !== 2) return undefined;
      resolved.push(...rooms.map((room) => room.id));
      continue;
    }
    if (state.selection.roomIds.length !== 1) return undefined;
    const other = rooms.filter((room) => room.id !== state.selection.roomIds[0]);
    if (other.length !== 1 || !other[0]) return undefined;
    resolved.push(other[0].id);
  }

  return uniqueStrings(resolved);
}

function validOccupancy(occupancy: readonly RoomOccupancy[], selectedRoomIds: readonly string[], guests?: number): boolean {
  const seen = new Set<string>();
  let total = 0;
  for (const entry of occupancy) {
    if (!selectedRoomIds.includes(entry.roomId) || seen.has(entry.roomId) || !validGuests(entry.guests)) return false;
    seen.add(entry.roomId);
    total += entry.guests;
  }
  if (guests !== undefined && occupancy.length > 0 && total !== guests) return false;
  return true;
}

function setRequestedDate(
  state: TaskStateV1,
  field: "checkIn" | "checkOut",
  value: string | null | undefined,
  event: UserSemanticEvent,
  revision: number,
  invalidations: string[],
): TaskStateRejection | undefined {
  if (value === undefined) return undefined;
  const previous = state.stay.requested[field]?.value;
  if (value === null) {
    if (previous !== undefined) {
      delete state.stay.requested[field];
      clearAvailability(state, invalidations, `stay_${field}_changed`);
    }
    return undefined;
  }
  if (!validIsoDate(value)) return "invalid_semantic_event";
  if (previous !== value) {
    state.stay.requested[field] = semanticFact(value, event, revision, "user");
    clearAvailability(state, invalidations, `stay_${field}_changed`);
  }
  return undefined;
}

function setRequestedGuests(
  state: TaskStateV1,
  value: number | null | undefined,
  event: UserSemanticEvent,
  revision: number,
  invalidations: string[],
): TaskStateRejection | undefined {
  if (value === undefined) return undefined;
  const previous = state.stay.requested.guests?.value;
  if (value === null) {
    if (previous !== undefined) {
      delete state.stay.requested.guests;
      clearAvailability(state, invalidations, "stay_guests_changed");
    }
    return undefined;
  }
  if (!validGuests(value)) return "invalid_semantic_event";
  if (previous !== value) {
    state.stay.requested.guests = semanticFact(value, event, revision, "user");
    clearAvailability(state, invalidations, "stay_guests_changed");
  }
  return undefined;
}

function validateStayRange(state: TaskStateV1): TaskStateRejection | undefined {
  const checkIn = state.stay.requested.checkIn?.value;
  const checkOut = state.stay.requested.checkOut?.value;
  if (!checkIn || !checkOut) return undefined;
  return checkIn < checkOut ? undefined : "invalid_semantic_event";
}

function applyUserSemanticEvent(
  current: TaskStateV1,
  event: UserSemanticEvent,
  revision: number,
  invalidations: string[],
): TaskStateV1 | TaskStateRejection {
  const state = structuredClone(current);
  const payload = event.payload;

  if (payload.goal !== undefined) {
    if (payload.goal === null) {
      if (state.goal) delete state.goal;
    } else if (state.goal?.value !== payload.goal) {
      state.goal = semanticFact(payload.goal, event, revision, "user");
      clearPreparedOperation(state, invalidations, "goal_changed");
    }
  }

  const dateCheckIn = setRequestedDate(state, "checkIn", payload.stay?.checkIn, event, revision, invalidations);
  if (dateCheckIn) return dateCheckIn;
  const dateCheckOut = setRequestedDate(state, "checkOut", payload.stay?.checkOut, event, revision, invalidations);
  if (dateCheckOut) return dateCheckOut;
  const guestCheck = setRequestedGuests(state, payload.stay?.guests, event, revision, invalidations);
  if (guestCheck) return guestCheck;
  const rangeCheck = validateStayRange(state);
  if (rangeCheck) return rangeCheck;

  if (payload.requestedRoomCount !== undefined) {
    if (payload.requestedRoomCount === null) {
      if (state.selection.requestedRoomCount !== undefined) delete state.selection.requestedRoomCount;
    } else {
      if (!validRoomCount(payload.requestedRoomCount)) return "invalid_semantic_event";
      state.selection.requestedRoomCount = payload.requestedRoomCount;
    }
  }

  if (payload.selection !== undefined) {
    if (payload.selection === null) {
      clearSelection(state, invalidations, "selection_changed");
    } else {
      const resolved = resolveReferences(state, payload.selection.references);
      if (!resolved) {
        state.selection.needsClarification = "selection";
      } else if (state.selection.requestedRoomCount !== undefined && state.selection.requestedRoomCount !== resolved.length) {
        state.selection.needsClarification = "selection";
      } else {
        if (!sameStrings(state.selection.roomIds, resolved)) clearPreparedOperation(state, invalidations, "selection_changed");
        state.selection.roomIds = resolved;
        state.selection.roomOccupancy = state.selection.roomOccupancy.filter((entry) => resolved.includes(entry.roomId));
        state.selection.basedOnAvailabilityRevision = state.availability.query?.observationRevision;
        delete state.selection.needsClarification;
      }
    }
  }

  if (state.selection.requestedRoomCount !== undefined && state.selection.roomIds.length > 0
    && state.selection.requestedRoomCount !== state.selection.roomIds.length) {
    state.selection.needsClarification = "selection";
  }

  if (payload.roomOccupancy !== undefined) {
    if (payload.roomOccupancy === null) {
      state.selection.roomOccupancy = [];
      if (state.selection.needsClarification === "occupancy") delete state.selection.needsClarification;
    } else {
      const guests = state.stay.requested.guests?.value;
      if (!validOccupancy(payload.roomOccupancy, state.selection.roomIds, guests)) {
        state.selection.needsClarification = "occupancy";
      } else {
        state.selection.roomOccupancy = payload.roomOccupancy.map((entry) => ({ ...entry }));
        if (state.selection.needsClarification === "occupancy") delete state.selection.needsClarification;
      }
    }
  }

  if (payload.ambiguity === "selection") state.selection.needsClarification = "selection";
  if (payload.ambiguity === "occupancy") state.selection.needsClarification = "occupancy";

  if (payload.clearPreferences) state.preferences = [];
  if (payload.preferences) {
    const known = new Set(state.preferences.map((preference) => preference.value.toLowerCase()));
    for (const raw of payload.preferences) {
      const value = raw.trim().slice(0, 120);
      const key = value.toLowerCase();
      if (!value || known.has(key)) continue;
      known.add(key);
      state.preferences.push(semanticFact(value, event, revision, "user"));
      if (state.preferences.length >= 8) break;
    }
  }

  if (payload.operationIntent) {
    if (payload.operationIntent.reserve === false && state.operationIntent.reserveRequested) state.operationIntent = {};
    if (payload.operationIntent.cancel === false && state.operationIntent.cancelRequested) state.operationIntent = {};
    if (payload.operationIntent.reserve === true) {
      const hasDates = Boolean(state.stay.requested.checkIn?.value && state.stay.requested.checkOut?.value);
      const hasGroundedSelection = state.selection.roomIds.length > 0
        && state.selection.basedOnAvailabilityRevision === state.availability.query?.observationRevision
        && state.selection.needsClarification === undefined;
      if (hasDates && hasGroundedSelection) state.operationIntent = { reserveRequested: true, revision };
    }
    if (payload.operationIntent.cancel === true) state.operationIntent = { cancelRequested: true, revision };
  }

  return state;
}

function applyToolObservationEvent(
  current: TaskStateV1,
  event: ToolObservationEvent,
  revision: number,
  invalidations: string[],
): TaskStateV1 | TaskStateRejection {
  const state = structuredClone(current);
  const payload = event.payload;

  if (payload.observation === "availability" || payload.observation === "availability_failed") {
    if (!validIsoDate(payload.query.checkIn) || !validIsoDate(payload.query.checkOut) || !validGuests(payload.query.guests)) return "invalid_tool_observation";
    if (payload.query.checkIn >= payload.query.checkOut) return "invalid_tool_observation";
    if (!sameQuery(requestedStay(state), payload.query)) return "stale_tool_observation";

    clearSelection(state, invalidations, "availability_changed");
    if (payload.observation === "availability_failed") {
      state.availability = { status: "failed", rooms: [] };
      return state;
    }

    const rooms = normalizeRooms(payload.rooms);
    if (!rooms) return "invalid_tool_observation";
    state.availability = {
      status: "available",
      query: {
        ...payload.query,
        observationRevision: revision,
      },
      rooms,
    };
    return state;
  }

  if (payload.observation === "booking_created") {
    const bookingIds = uniqueStrings(payload.bookingIds);
    if (bookingIds.length === 0 || bookingIds.length !== payload.bookingIds.length) return "invalid_tool_observation";
    if (state.reservation.status !== "approved") return "invalid_tool_observation";
    state.reservation = {
      status: "confirmed",
      ...(state.reservation.preparedFingerprint ? { preparedFingerprint: state.reservation.preparedFingerprint } : {}),
      ...(state.reservation.basedOnStateRevision !== undefined ? { basedOnStateRevision: state.reservation.basedOnStateRevision } : {}),
      bookingIds,
    };
    state.operationIntent = {};
    return state;
  }

  if (state.reservation.status === "none" || state.reservation.status === "confirmed") return "invalid_tool_observation";
  state.reservation = {
    status: "failed",
    ...(state.reservation.preparedFingerprint ? { preparedFingerprint: state.reservation.preparedFingerprint } : {}),
    ...(state.reservation.basedOnStateRevision !== undefined ? { basedOnStateRevision: state.reservation.basedOnStateRevision } : {}),
    bookingIds: [],
  };
  return state;
}

function applyServerControlEvent(
  current: TaskStateV1,
  event: ServerControlEvent,
  revision: number,
  invalidations: string[],
): TaskStateV1 | TaskStateRejection {
  const state = structuredClone(current);
  const payload = event.payload;

  if (payload.control === "operation_invalidated") {
    clearPreparedOperation(state, invalidations, "server_operation_invalidated");
    return state;
  }

  const fingerprint = payload.operationFingerprint.trim();
  if (!fingerprint) return "invalid_server_control";

  if (payload.control === "operation_prepared") {
    if (!state.operationIntent.reserveRequested || state.selection.roomIds.length === 0 || state.selection.needsClarification) return "invalid_server_control";
    state.reservation = {
      status: "prepared",
      preparedFingerprint: fingerprint,
      basedOnStateRevision: current.stateRevision,
      bookingIds: [],
    };
    return state;
  }

  if (payload.control === "approval_required") {
    if (state.reservation.status !== "prepared" || state.reservation.preparedFingerprint !== fingerprint) return "invalid_server_control";
    state.reservation = {
      ...state.reservation,
      status: "approval_required",
    };
    return state;
  }

  if (state.reservation.status !== "approval_required" || state.reservation.preparedFingerprint !== fingerprint) return "invalid_server_control";
  state.reservation = {
    ...state.reservation,
    status: "approved",
  };
  return state;
}

export function reduceTaskState(current: TaskStateV1, event: TaskEvent): TaskStateReduction {
  const original = structuredClone(current);
  if (event.sessionId !== current.sessionId || event.taskId !== current.taskId) {
    return { state: original, accepted: false, materialChange: false, invalidations: [], rejection: "scope_mismatch" };
  }
  if (current.processedEventIds.includes(event.eventId)) {
    return { state: original, accepted: true, materialChange: false, invalidations: [] };
  }
  if (event.expectedStateRevision !== current.stateRevision) {
    return { state: original, accepted: false, materialChange: false, invalidations: [], rejection: "state_revision_conflict" };
  }

  const revision = current.stateRevision + 1;
  const invalidations: string[] = [];
  const result = event.kind === "user.semantic"
    ? applyUserSemanticEvent(current, event, revision, invalidations)
    : event.kind === "tool.observation"
      ? applyToolObservationEvent(current, event, revision, invalidations)
      : applyServerControlEvent(current, event, revision, invalidations);

  if (typeof result === "string") {
    return { state: original, accepted: false, materialChange: false, invalidations: [], rejection: result };
  }

  const materialChange = JSON.stringify(result) !== JSON.stringify(current);
  if (!materialChange) return { state: original, accepted: true, materialChange: false, invalidations };

  result.stateRevision = revision;
  result.processedEventIds = [...result.processedEventIds, event.eventId];
  return {
    state: result,
    accepted: true,
    materialChange: true,
    invalidations: uniqueStrings(invalidations),
  };
}
