import type {
  AvailabilityFailedEvent,
  AvailabilityObservedEvent,
  BookingCancelledEvent,
  BookingCreatedEvent,
  BookingsCancelledEvent,
  BookingsCreatedEvent,
  OperationExecutionFailedEvent,
  OperationPartialOutcomeEvent,
  QuoteFailedEvent,
  QuoteObservedEvent,
  TaskEvent,
} from "./task-events.js";
import type { AvailabilityCandidate, BookingObservation, PreparedOperation, TaskStateV1 } from "./task-state.js";

export type ToolOutcomeCorrelation =
  | { kind: "invocation"; invocationId: string }
  | { kind: "operation"; operationId: string };

export type ToolOutcomeEnvelope =
  | {
      outcome: "success";
      eventId: string;
      observationRevision: number;
      observedAt: string;
      correlation: ToolOutcomeCorrelation;
      result: unknown;
    }
  | {
      outcome: "failure";
      eventId: string;
      observationRevision: number;
      observedAt: string;
      correlation: ToolOutcomeCorrelation;
      failureCode: string;
    };

export type ObservationMappingSuccess = {
  ok: true;
  event: TaskEvent;
};

export type ObservationMappingFailure = {
  ok: false;
  failureCode: string;
};

export type ObservationMappingResult = ObservationMappingSuccess | ObservationMappingFailure;

function fail(failureCode: string): ObservationMappingFailure {
  return { ok: false, failureCode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validRevision(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function validFailureCode(value: string): boolean {
  return /^[A-Z0-9_:-]{1,128}$/.test(value);
}

function exactInvocation(state: Readonly<TaskStateV1>, correlation: ToolOutcomeCorrelation) {
  if (correlation.kind !== "invocation") return undefined;
  const pending = state.pendingToolInvocation;
  if (!pending || pending.status !== "pending" || pending.invocationId !== correlation.invocationId) return undefined;
  return pending;
}

function exactExecution(state: Readonly<TaskStateV1>, correlation: ToolOutcomeCorrelation) {
  if (correlation.kind !== "operation") return undefined;
  const execution = state.execution;
  const operation = state.preparedOperation;
  if (execution.status !== "executing" || execution.operationId !== correlation.operationId) return undefined;
  if (!operation || operation.operationId !== correlation.operationId) return undefined;
  if (execution.operationFingerprint !== operation.operationFingerprint
    || execution.dependencyFingerprint !== operation.dependencyFingerprint) return undefined;
  return { execution, operation };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (items.some((item) => !item) || new Set(items).size !== items.length) return undefined;
  return items;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((item) => set.has(item));
}

function bookingObservation(
  bookingId: string,
  observationRevision: number,
  status?: string,
  roomIds?: readonly string[],
): BookingObservation {
  return {
    bookingId,
    observationRevision,
    ...(status ? { status } : {}),
    ...(roomIds && roomIds.length > 0 ? { roomIds: [...roomIds] } : {}),
  };
}

function parseAvailability(
  raw: unknown,
  expectedInput: Readonly<Record<string, unknown>>,
): { rooms: AvailabilityCandidate[]; guestCapacityCoverage: "enforced" | "not_modeled" } | undefined {
  if (!isRecord(raw) || !nonEmptyString(raw.source) || !Array.isArray(raw.rooms)) return undefined;
  const expectedCheckIn = expectedInput.checkIn;
  const expectedCheckOut = expectedInput.checkOut;
  const expectedGuests = expectedInput.guests;
  if (typeof expectedCheckIn !== "string" || typeof expectedCheckOut !== "string" || !Number.isInteger(expectedGuests)) return undefined;

  let coverage: "enforced" | "not_modeled";
  if (raw.source === "hms") {
    if (raw.truth !== "transactional"
      || raw.start !== expectedCheckIn
      || raw.end !== expectedCheckOut
      || raw.requestedGuests !== expectedGuests
      || raw.capacityMode !== "not_modeled"
      || raw.capacityFilterApplied !== false) return undefined;
    coverage = "not_modeled";
  } else if (raw.source === "fake-hms") {
    if (raw.checkIn !== expectedCheckIn || raw.checkOut !== expectedCheckOut || raw.guests !== expectedGuests) return undefined;
    coverage = "enforced";
  } else {
    return undefined;
  }

  const rooms: AvailabilityCandidate[] = [];
  const seen = new Set<string>();
  for (const item of raw.rooms) {
    if (!isRecord(item) || !nonEmptyString(item.id) || seen.has(item.id)) return undefined;
    seen.add(item.id);
    const room: AvailabilityCandidate = { roomId: item.id.trim() };
    if (item.roomNumber !== undefined) {
      if (!nonEmptyString(item.roomNumber)) return undefined;
      room.roomNumber = item.roomNumber.trim();
    }
    if (item.roomType !== undefined) {
      if (!nonEmptyString(item.roomType)) return undefined;
      room.roomType = item.roomType.trim();
    }
    if (raw.source === "fake-hms" && item.capacity !== undefined) {
      if (!Number.isInteger(item.capacity) || Number(item.capacity) < 1) return undefined;
      room.capacity = Number(item.capacity);
    }
    rooms.push(room);
  }
  return { rooms, guestCapacityCoverage: coverage };
}

function parseQuote(
  raw: unknown,
  expectedInput: Readonly<Record<string, unknown>>,
): { roomId: string; amountCents: number; currency: string } | undefined {
  if (!isRecord(raw) || !nonEmptyString(raw.source)) return undefined;
  const roomId = expectedInput.roomId;
  const checkIn = expectedInput.checkIn;
  const checkOut = expectedInput.checkOut;
  if (!nonEmptyString(roomId) || typeof checkIn !== "string" || typeof checkOut !== "string") return undefined;
  if (raw.roomId !== roomId || !Number.isInteger(raw.totalCents) || Number(raw.totalCents) < 0 || !nonEmptyString(raw.currency)) return undefined;
  if (raw.source === "hms") {
    if (raw.truth !== "transactional" || raw.start !== checkIn || raw.end !== checkOut) return undefined;
  } else if (raw.source !== "fake-hms") {
    return undefined;
  }
  return { roomId, amountCents: Number(raw.totalCents), currency: raw.currency.trim() };
}

function operationEventBase(state: Readonly<TaskStateV1>, eventId: string) {
  const operation = state.preparedOperation!;
  return {
    eventId,
    taskId: state.taskId,
    sessionId: state.sessionId,
    operationId: operation.operationId,
    operationFingerprint: operation.operationFingerprint,
    dependencyFingerprint: operation.dependencyFingerprint,
  };
}

function parseSingleReservation(
  state: Readonly<TaskStateV1>,
  operation: Readonly<PreparedOperation>,
  raw: unknown,
  revision: number,
): BookingObservation | undefined {
  if (!isRecord(raw) || raw.source !== "hms" || raw.truth !== "transactional") return undefined;
  const input = operation.canonicalInputSnapshot;
  if (!nonEmptyString(input.roomId) || typeof input.checkIn !== "string" || typeof input.checkOut !== "string") return undefined;
  if (!nonEmptyString(raw.bookingId) || raw.roomId !== input.roomId || raw.start !== input.checkIn || raw.end !== input.checkOut || !nonEmptyString(raw.status)) return undefined;
  return bookingObservation(raw.bookingId.trim(), revision, raw.status.trim(), [input.roomId]);
}

function parseSingleCancellation(
  state: Readonly<TaskStateV1>,
  operation: Readonly<PreparedOperation>,
  raw: unknown,
  revision: number,
): BookingObservation | undefined {
  if (!isRecord(raw) || raw.source !== "hms" || raw.truth !== "transactional") return undefined;
  const expectedBookingId = operation.canonicalInputSnapshot.bookingId;
  if (!nonEmptyString(expectedBookingId) || raw.bookingId !== expectedBookingId || !nonEmptyString(raw.status)) return undefined;
  const prior = state.bookings.find((booking) => booking.bookingId === expectedBookingId);
  const roomIds = prior?.roomIds ?? (nonEmptyString(raw.roomId) ? [raw.roomId.trim()] : undefined);
  return bookingObservation(expectedBookingId, revision, raw.status.trim(), roomIds);
}

function parseConfirmedMultiCreate(
  operation: Readonly<PreparedOperation>,
  raw: Record<string, unknown>,
  revision: number,
): BookingObservation[] | undefined {
  const roomIds = stringArray(operation.canonicalInputSnapshot.roomIds);
  const bookingIds = stringArray(raw.bookingIds);
  const createdBookingIds = stringArray(raw.createdBookingIds);
  if (!roomIds || !bookingIds || !createdBookingIds || raw.outcome !== "confirmed") return undefined;
  if (!sameSet(bookingIds, createdBookingIds) || bookingIds.length !== roomIds.length) return undefined;
  return createdBookingIds.map((bookingId, index) => bookingObservation(bookingId, revision, "confirmed", [roomIds[index]!]));
}

function parsePartialMultiCreate(
  operation: Readonly<PreparedOperation>,
  raw: Record<string, unknown>,
  revision: number,
): BookingObservation[] | undefined {
  const roomIds = stringArray(operation.canonicalInputSnapshot.roomIds);
  const surviving = stringArray(raw.bookingIds);
  const created = stringArray(raw.createdBookingIds);
  const compensated = stringArray(raw.compensatedBookingIds);
  if (!roomIds || !surviving || !created || !compensated || raw.outcome !== "compensation_failed") return undefined;
  if (created.length > roomIds.length || !surviving.every((bookingId) => created.includes(bookingId)) || !compensated.every((bookingId) => created.includes(bookingId))) return undefined;
  if (surviving.some((bookingId) => compensated.includes(bookingId))) return undefined;
  return surviving.map((bookingId) => {
    const index = created.indexOf(bookingId);
    return bookingObservation(bookingId, revision, "confirmed_partial", index >= 0 ? [roomIds[index]!] : undefined);
  });
}

function cancelledObservations(
  state: Readonly<TaskStateV1>,
  bookingIds: readonly string[],
  revision: number,
): BookingObservation[] {
  return bookingIds.map((bookingId) => {
    const prior = state.bookings.find((booking) => booking.bookingId === bookingId);
    return bookingObservation(bookingId, revision, "cancelled", prior?.roomIds);
  });
}

function mapRead(
  state: Readonly<TaskStateV1>,
  envelope: ToolOutcomeEnvelope,
): ObservationMappingResult {
  const pending = exactInvocation(state, envelope.correlation);
  if (!pending) return fail("OBSERVATION_INVOCATION_BINDING_MISMATCH");

  const base = {
    eventId: envelope.eventId,
    taskId: state.taskId,
    sessionId: state.sessionId,
    invocationId: pending.invocationId,
    dependencyFingerprint: pending.dependencyFingerprint,
  };

  if (envelope.outcome === "failure") {
    if (!validFailureCode(envelope.failureCode)) return fail("OBSERVATION_FAILURE_CODE_INVALID");
    if (pending.capabilityId === "availability") {
      const event: AvailabilityFailedEvent = { kind: "availability_failed", ...base };
      return { ok: true, event };
    }
    if (pending.capabilityId === "quote") {
      const event: QuoteFailedEvent = { kind: "quote_failed", ...base };
      return { ok: true, event };
    }
    return fail("OBSERVATION_READ_CAPABILITY_UNSUPPORTED");
  }

  if (pending.capabilityId === "availability") {
    const parsed = parseAvailability(envelope.result, pending.inputSnapshot);
    if (!parsed) return fail("OBSERVATION_AVAILABILITY_RESULT_INVALID");
    const event: AvailabilityObservedEvent = {
      kind: "availability_observed",
      ...base,
      observationRevision: envelope.observationRevision,
      rooms: parsed.rooms,
      guestCapacityCoverage: parsed.guestCapacityCoverage,
      observedAt: envelope.observedAt,
    };
    return { ok: true, event };
  }

  if (pending.capabilityId === "quote") {
    const parsed = parseQuote(envelope.result, pending.inputSnapshot);
    if (!parsed) return fail("OBSERVATION_QUOTE_RESULT_INVALID");
    const event: QuoteObservedEvent = {
      kind: "quote_observed",
      ...base,
      observationRevision: envelope.observationRevision,
      roomIds: [parsed.roomId],
      amountCents: parsed.amountCents,
      currency: parsed.currency,
      observedAt: envelope.observedAt,
    };
    return { ok: true, event };
  }

  return fail("OBSERVATION_READ_CAPABILITY_UNSUPPORTED");
}

function mapWrite(
  state: Readonly<TaskStateV1>,
  envelope: ToolOutcomeEnvelope,
): ObservationMappingResult {
  const bound = exactExecution(state, envelope.correlation);
  if (!bound) return fail("OBSERVATION_OPERATION_BINDING_MISMATCH");
  const operation = bound.operation;
  const base = operationEventBase(state, envelope.eventId);

  if (envelope.outcome === "failure") {
    if (!validFailureCode(envelope.failureCode)) return fail("OBSERVATION_FAILURE_CODE_INVALID");
    const event: OperationExecutionFailedEvent = { kind: "operation_execution_failed", ...base, failureCode: envelope.failureCode };
    return { ok: true, event };
  }

  if (operation.capabilityId === "reserve_single") {
    const booking = parseSingleReservation(state, operation, envelope.result, envelope.observationRevision);
    if (!booking) return fail("OBSERVATION_RESERVATION_RESULT_INVALID");
    const event: BookingCreatedEvent = { kind: "booking_created", ...base, booking };
    return { ok: true, event };
  }

  if (operation.capabilityId === "cancel_single") {
    const booking = parseSingleCancellation(state, operation, envelope.result, envelope.observationRevision);
    if (!booking) return fail("OBSERVATION_CANCELLATION_RESULT_INVALID");
    const event: BookingCancelledEvent = { kind: "booking_cancelled", ...base, booking };
    return { ok: true, event };
  }

  if (operation.capabilityId === "reserve_multi") {
    if (!isRecord(envelope.result) || envelope.result.source !== "hms" || envelope.result.truth !== "transactional") {
      return fail("OBSERVATION_MULTI_RESERVATION_RESULT_INVALID");
    }
    if (envelope.result.outcome === "confirmed") {
      const bookings = parseConfirmedMultiCreate(operation, envelope.result, envelope.observationRevision);
      if (!bookings) return fail("OBSERVATION_MULTI_RESERVATION_RESULT_INVALID");
      const event: BookingsCreatedEvent = { kind: "bookings_created", ...base, bookings };
      return { ok: true, event };
    }
    if (envelope.result.outcome === "compensated") {
      const bookingIds = stringArray(envelope.result.bookingIds);
      if (!bookingIds || bookingIds.length !== 0) return fail("OBSERVATION_MULTI_RESERVATION_RESULT_INVALID");
      const event: OperationExecutionFailedEvent = {
        kind: "operation_execution_failed",
        ...base,
        failureCode: "MULTI_RESERVATION_COMPENSATED",
      };
      return { ok: true, event };
    }
    if (envelope.result.outcome === "compensation_failed") {
      const bookings = parsePartialMultiCreate(operation, envelope.result, envelope.observationRevision);
      if (!bookings || bookings.length === 0) return fail("OBSERVATION_MULTI_RESERVATION_RESULT_INVALID");
      const event: OperationPartialOutcomeEvent = {
        kind: "operation_partial_outcome",
        ...base,
        outcomeKind: "booking_created_partial",
        bookings,
        failureCode: "MULTI_RESERVATION_COMPENSATION_FAILED",
      };
      return { ok: true, event };
    }
    return fail("OBSERVATION_MULTI_RESERVATION_RESULT_INVALID");
  }

  if (operation.capabilityId === "cancel_multi") {
    if (!isRecord(envelope.result) || envelope.result.source !== "hms" || envelope.result.truth !== "transactional") {
      return fail("OBSERVATION_MULTI_CANCELLATION_RESULT_INVALID");
    }
    const expectedIds = stringArray(operation.canonicalInputSnapshot.bookingIds);
    const cancelledIds = stringArray(envelope.result.cancelledBookingIds);
    const failedIds = stringArray(envelope.result.failedBookingIds);
    if (!expectedIds || !cancelledIds || !failedIds) return fail("OBSERVATION_MULTI_CANCELLATION_RESULT_INVALID");
    if (cancelledIds.some((id) => failedIds.includes(id)) || !sameSet([...cancelledIds, ...failedIds], expectedIds)) {
      return fail("OBSERVATION_MULTI_CANCELLATION_RESULT_INVALID");
    }
    const bookings = cancelledObservations(state, cancelledIds, envelope.observationRevision);
    if (envelope.result.outcome === "cancelled") {
      if (failedIds.length !== 0 || bookings.length === 0) return fail("OBSERVATION_MULTI_CANCELLATION_RESULT_INVALID");
      const event: BookingsCancelledEvent = { kind: "bookings_cancelled", ...base, bookings };
      return { ok: true, event };
    }
    if (envelope.result.outcome === "partial_failure") {
      if (failedIds.length === 0) return fail("OBSERVATION_MULTI_CANCELLATION_RESULT_INVALID");
      const event: OperationPartialOutcomeEvent = {
        kind: "operation_partial_outcome",
        ...base,
        outcomeKind: "booking_cancelled_partial",
        bookings,
        failureCode: "MULTI_CANCELLATION_PARTIAL_FAILURE",
      };
      return { ok: true, event };
    }
    return fail("OBSERVATION_MULTI_CANCELLATION_RESULT_INVALID");
  }

  return fail("OBSERVATION_WRITE_CAPABILITY_UNSUPPORTED");
}

export function mapToolOutcomeToTaskEvent(
  state: Readonly<TaskStateV1>,
  envelope: Readonly<ToolOutcomeEnvelope>,
): ObservationMappingResult {
  if (!envelope.eventId.trim() || !validRevision(envelope.observationRevision) || !envelope.observedAt.trim()) {
    return fail("OBSERVATION_ENVELOPE_INVALID");
  }
  return envelope.correlation.kind === "invocation"
    ? mapRead(state, envelope)
    : mapWrite(state, envelope);
}
