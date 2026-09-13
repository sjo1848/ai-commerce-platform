import { stableStringify } from "./idempotency.js";
import type { AskField, GroundedReference, NextStep } from "./planning.js";
import type { ResponsePublishedEvent } from "./task-events.js";
import { reduceTaskState, type ReductionResult } from "./task-reducer.js";
import type {
  PublishedDialogueAnchor,
  PublishedPendingClarification,
  PublishedSemanticEntity,
  TaskStateV1,
} from "./task-state.js";

export type ResponsePurpose =
  | "ask"
  | "present_options"
  | "acknowledge"
  | "approval_required"
  | "success"
  | "failure"
  | "no_results"
  | "unsupported"
  | "degrade";

export type ResponseRenderingMode = "DETERMINISTIC_CRITICAL" | "BOUNDED_TASK";

export type ResponseGroundedFact = {
  factId: string;
  type: string;
  displayValue: string;
  sourceRef: string;
  sourceRevision?: number;
  visibility: "user";
};

export type ResponsePresentationEntity = PublishedSemanticEntity;

export type ResponseQuestionSpec = {
  field: AskField;
  reason: string;
};

export type ResponseCriticalActionSpec = {
  kind: "approval_required" | "success" | "failure";
  partial?: boolean;
};

export type ResponseAssertionPolicy = {
  allowedFactIds: readonly string[];
  questionField?: AskField;
  allowSuccessClaim: boolean;
  allowFailureClaim: boolean;
};

export type ResponseContext = {
  responseId: string;
  purpose: ResponsePurpose;
  taskId: string;
  stateRevision: number;
  responseDependencyFingerprint: string;
  renderingMode: ResponseRenderingMode;
  groundedFacts: readonly ResponseGroundedFact[];
  presentationEntities: readonly ResponsePresentationEntity[];
  questionSpec?: ResponseQuestionSpec;
  criticalActionSpec?: ResponseCriticalActionSpec;
  taskSummary: {
    goal?: string;
    checkIn?: string;
    checkOut?: string;
    guests?: number;
  };
  locale: string;
  toneProfile: string;
  assertionPolicy: ResponseAssertionPolicy;
};

export type DialogueAnchorCandidate = {
  responseId: string;
  responseDependencyFingerprint: string;
  anchor: PublishedDialogueAnchor;
};

export type PendingClarificationCandidate = PublishedPendingClarification;

export type ResponsePublicationCandidate = {
  taskId: string;
  sessionId: string;
  builtAtStateRevision: number;
  nextStep: NextStep;
  responseDependencyFingerprint: string;
  context: ResponseContext;
  dialogueAnchorCandidate?: DialogueAnchorCandidate;
  pendingClarificationCandidate?: PendingClarificationCandidate;
};

export type ResponseBuildResult =
  | { ok: true; candidate: ResponsePublicationCandidate }
  | { ok: false; failureCode: string };

export type ResponsePublicationAdmission = {
  candidate: ResponsePublicationCandidate;
  expectedStateRevision: number;
  revisionChangedSinceBuild: boolean;
};

export type ResponseAdmissionResult =
  | { ok: true; admission: ResponsePublicationAdmission }
  | { ok: false; failureCode: string };

export type ResponseCommitResult =
  | { ok: true; event: ResponsePublishedEvent; reduction: ReductionResult }
  | { ok: false; failureCode: string; reduction?: ReductionResult };

function semanticOperationIntent(state: Readonly<TaskStateV1>): unknown {
  const intent = state.operationIntent;
  if (!intent) return null;
  const { provenance: _provenance, ...semantic } = intent;
  return semantic;
}

function sameOrdered(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function roomById(state: Readonly<TaskStateV1>, roomId: string) {
  return state.availability.status === "observed"
    ? state.availability.rooms.find((room) => room.roomId === roomId)
    : undefined;
}

function safeRoomProjection(state: Readonly<TaskStateV1>, roomIds: readonly string[]): readonly Record<string, unknown>[] | undefined {
  const result: Record<string, unknown>[] = [];
  for (const roomId of roomIds) {
    const room = roomById(state, roomId);
    if (!room) return undefined;
    result.push({
      roomId,
      ...(room.roomNumber ? { roomNumber: room.roomNumber } : {}),
      ...(room.roomType ? { roomType: room.roomType } : {}),
      ...(room.capacity !== undefined ? { capacity: room.capacity } : {}),
    });
  }
  return result;
}

function availabilityProjection(
  state: Readonly<TaskStateV1>,
  observationRevision: number,
  roomIds: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  const availability = state.availability;
  if (availability.status !== "observed"
    || availability.observationRevision !== observationRevision
    || !availability.dependencyFingerprint) return undefined;
  const currentRoomIds = availability.rooms.map((room) => room.roomId);
  if (!sameOrdered(roomIds, currentRoomIds)) return undefined;
  const rooms = safeRoomProjection(state, roomIds);
  if (!rooms) return undefined;
  return {
    kind: "availability",
    observationRevision,
    dependencyFingerprint: availability.dependencyFingerprint,
    rooms,
    guestCapacityCoverage: availability.guestCapacityCoverage ?? null,
    querySnapshot: availability.querySnapshot ?? null,
  };
}

function groundedReferenceProjection(
  state: Readonly<TaskStateV1>,
  reference: Readonly<GroundedReference>,
): Readonly<Record<string, unknown>> | undefined {
  if (reference.kind === "availability") {
    return availabilityProjection(state, reference.observationRevision, reference.roomIds);
  }
  if (reference.kind === "quote") {
    const quote = state.quote;
    if (quote.status !== "observed"
      || quote.observationRevision !== reference.observationRevision
      || !quote.dependencyFingerprint
      || quote.amountCents === undefined
      || !quote.currency
      || !sameOrdered(quote.roomIds, reference.roomIds)) return undefined;
    return {
      kind: "quote",
      observationRevision: quote.observationRevision,
      dependencyFingerprint: quote.dependencyFingerprint,
      roomIds: [...quote.roomIds],
      amountCents: quote.amountCents,
      currency: quote.currency,
    };
  }
  if (reference.kind === "selection") {
    const selection = state.groundedSelection;
    if (selection.status !== "grounded" || !selection.dependencyFingerprint || !sameOrdered(selection.roomIds, reference.roomIds)) return undefined;
    return {
      kind: "selection",
      roomIds: [...selection.roomIds],
      dependencyFingerprint: selection.dependencyFingerprint,
      basedOnAvailabilityRevision: selection.basedOnAvailabilityRevision ?? null,
    };
  }
  if (reference.kind === "booking") {
    const booking = state.bookings.find((item) => item.bookingId === reference.bookingId);
    if (!booking) return undefined;
    return {
      kind: "booking",
      bookingId: booking.bookingId,
      observationRevision: booking.observationRevision,
      status: booking.status ?? null,
      roomIds: booking.roomIds ? [...booking.roomIds] : [],
    };
  }
  const operation = state.preparedOperation?.operationId === reference.operationId ? state.preparedOperation : undefined;
  const executionMatches = state.execution.operationId === reference.operationId;
  if (!operation && !executionMatches) return undefined;
  return {
    kind: "operation",
    operationId: reference.operationId,
    prepared: operation ? {
      status: operation.status,
      capabilityId: operation.capabilityId,
      toolId: operation.toolId,
      operationFingerprint: operation.operationFingerprint,
      dependencyFingerprint: operation.dependencyFingerprint,
    } : null,
    execution: executionMatches ? {
      status: state.execution.status,
      operationFingerprint: state.execution.operationFingerprint ?? null,
      dependencyFingerprint: state.execution.dependencyFingerprint ?? null,
      outcomeKind: state.execution.outcomeKind ?? null,
      failureCode: state.execution.failureCode ?? null,
    } : null,
  };
}

function groundedReferencesProjection(
  state: Readonly<TaskStateV1>,
  references: readonly GroundedReference[],
): readonly Readonly<Record<string, unknown>>[] | undefined {
  const result: Readonly<Record<string, unknown>>[] = [];
  for (const reference of references) {
    const projected = groundedReferenceProjection(state, reference);
    if (!projected) return undefined;
    result.push(projected);
  }
  return result;
}

function commonDependencyProjection(state: Readonly<TaskStateV1>) {
  return {
    lifecycle: state.lifecycle,
    requestedGoal: state.requestedGoal?.value ?? null,
    operationIntent: semanticOperationIntent(state),
  };
}

function responseDependencyProjection(
  state: Readonly<TaskStateV1>,
  step: Readonly<NextStep>,
): Readonly<Record<string, unknown>> | undefined {
  const common = commonDependencyProjection(state);

  if (step.kind === "CALL_TOOL") return undefined;

  if (step.kind === "ASK") {
    const presentation = step.presentationContext
      ? availabilityProjection(state, step.presentationContext.observationRevision, step.presentationContext.roomIds)
      : null;
    if (step.presentationContext && !presentation) return undefined;
    return {
      common,
      step: { kind: step.kind, field: step.field, reason: step.reason, dialogueAnchorSpec: step.dialogueAnchorSpec },
      requestedStay: {
        checkIn: state.requestedStay.checkIn?.value ?? null,
        checkOut: state.requestedStay.checkOut?.value ?? null,
        guests: state.requestedStay.guests?.value ?? null,
      },
      bookingReference: state.bookingReference?.value ?? null,
      presentation,
    };
  }

  if (step.kind === "RESPOND" || step.kind === "COMPLETE") {
    const refs = groundedReferencesProjection(state, step.groundedReferences);
    if (!refs) return undefined;
    return {
      common,
      step: step.kind === "RESPOND"
        ? { kind: step.kind, responseIntent: step.responseIntent }
        : { kind: step.kind, responseIntent: step.responseIntent, completionReason: step.completionReason },
      references: refs,
      execution: step.kind === "COMPLETE" ? structuredClone(state.execution) : null,
    };
  }

  if (step.kind === "WAIT") {
    if (step.reason === "approval_pending") {
      const operation = state.preparedOperation;
      if (!operation || operation.operationId !== step.correlationId) return undefined;
      return {
        common,
        step: { kind: step.kind, reason: step.reason },
        operation: {
          operationId: operation.operationId,
          status: operation.status,
          capabilityId: operation.capabilityId,
          operationFingerprint: operation.operationFingerprint,
          dependencyFingerprint: operation.dependencyFingerprint,
        },
      };
    }
    return {
      common,
      step: { kind: step.kind, reason: step.reason, correlationId: step.correlationId ?? null },
      pendingTool: state.pendingToolInvocation ? {
        invocationId: state.pendingToolInvocation.invocationId,
        status: state.pendingToolInvocation.status,
        dependencyFingerprint: state.pendingToolInvocation.dependencyFingerprint,
      } : null,
      execution: structuredClone(state.execution),
    };
  }

  return {
    common,
    step: { kind: step.kind, reasonCode: step.reasonCode, recoverable: step.recoverable, responseIntent: step.responseIntent },
    execution: step.responseIntent === "operation_failed" ? structuredClone(state.execution) : null,
    preparedOperation: step.responseIntent === "approval_invalidated" && state.preparedOperation
      ? {
          operationId: state.preparedOperation.operationId,
          status: state.preparedOperation.status,
          operationFingerprint: state.preparedOperation.operationFingerprint,
          dependencyFingerprint: state.preparedOperation.dependencyFingerprint,
        }
      : null,
  };
}

async function opaqueResponseFingerprint(projection: unknown): Promise<string> {
  const payload = new TextEncoder().encode(`response:v1\u0000${stableStringify(projection)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `resp:v1:${hex}`;
}

function purposeForStep(step: Readonly<NextStep>): ResponsePurpose | undefined {
  if (step.kind === "CALL_TOOL") return undefined;
  if (step.kind === "ASK") return step.presentationContext ? "present_options" : "ask";
  if (step.kind === "WAIT") return step.reason === "approval_pending" ? "approval_required" : "acknowledge";
  if (step.kind === "COMPLETE") return "success";
  if (step.kind === "DEGRADE") {
    if (/UNAVAILABLE|UNSUPPORTED/.test(step.reasonCode)) return "unsupported";
    return step.responseIntent === "operation_failed" ? "failure" : "degrade";
  }
  if (step.responseIntent === "no_availability") return "no_results";
  if (step.responseIntent === "availability_result") return "present_options";
  if (step.responseIntent === "approval_invalidated" || step.responseIntent.includes("failed")) return "failure";
  return "acknowledge";
}

function renderingMode(purpose: ResponsePurpose): ResponseRenderingMode {
  return ["approval_required", "success", "failure", "no_results", "unsupported", "degrade"].includes(purpose)
    ? "DETERMINISTIC_CRITICAL"
    : "BOUNDED_TASK";
}

function roomPresentationEntities(
  state: Readonly<TaskStateV1>,
  roomIds: readonly string[],
): ResponsePresentationEntity[] | undefined {
  const entities: ResponsePresentationEntity[] = [];
  for (let index = 0; index < roomIds.length; index += 1) {
    const room = roomById(state, roomIds[index]!);
    if (!room) return undefined;
    entities.push({
      entityType: "room",
      ordinal: index + 1,
      ...(room.roomNumber ? { roomNumber: room.roomNumber } : {}),
      ...(room.roomType ? { label: room.roomType } : {}),
    });
  }
  return entities;
}

function bookingPresentationEntities(
  state: Readonly<TaskStateV1>,
  bookingIds: readonly string[],
): ResponsePresentationEntity[] | undefined {
  const entities: ResponsePresentationEntity[] = [];
  for (let index = 0; index < bookingIds.length; index += 1) {
    const booking = state.bookings.find((item) => item.bookingId === bookingIds[index]);
    if (!booking) return undefined;
    entities.push({ entityType: "booking", ordinal: index + 1, bookingCode: booking.bookingId });
  }
  return entities;
}

function presentationEntitiesForStep(state: Readonly<TaskStateV1>, step: Readonly<NextStep>): ResponsePresentationEntity[] | undefined {
  if (step.kind === "ASK" && step.presentationContext) {
    return roomPresentationEntities(state, step.presentationContext.roomIds);
  }
  if (step.kind === "RESPOND" || step.kind === "COMPLETE") {
    const availability = step.groundedReferences.find((reference) => reference.kind === "availability");
    if (availability?.kind === "availability") return roomPresentationEntities(state, availability.roomIds);
    const selection = step.groundedReferences.find((reference) => reference.kind === "selection");
    if (selection?.kind === "selection") return roomPresentationEntities(state, selection.roomIds);
    const bookingIds = step.groundedReferences.filter((reference): reference is Extract<GroundedReference, { kind: "booking" }> => reference.kind === "booking").map((reference) => reference.bookingId);
    if (bookingIds.length > 0) return bookingPresentationEntities(state, bookingIds);
  }
  return [];
}

function fact(
  factId: string,
  type: string,
  displayValue: string,
  sourceRef: string,
  sourceRevision?: number,
): ResponseGroundedFact {
  return {
    factId,
    type,
    displayValue,
    sourceRef,
    ...(sourceRevision !== undefined ? { sourceRevision } : {}),
    visibility: "user",
  };
}

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function factsForStep(state: Readonly<TaskStateV1>, step: Readonly<NextStep>): ResponseGroundedFact[] {
  const facts: ResponseGroundedFact[] = [];

  const availabilityRef = (step.kind === "RESPOND" || step.kind === "COMPLETE")
    ? step.groundedReferences.find((reference): reference is Extract<GroundedReference, { kind: "availability" }> => reference.kind === "availability")
    : undefined;
  const presentationAvailability = step.kind === "ASK" ? step.presentationContext : undefined;
  const availabilityRevision = availabilityRef?.observationRevision ?? presentationAvailability?.observationRevision;
  if (availabilityRevision !== undefined && state.availability.status === "observed" && state.availability.observationRevision === availabilityRevision) {
    facts.push(fact("availability_count", "count", String(state.availability.rooms.length), "availability", availabilityRevision));
    if (state.availability.guestCapacityCoverage === "not_modeled") {
      facts.push(fact(
        "guest_capacity_limitation",
        "limitation",
        "La disponibilidad consultada no valida la capacidad de huéspedes por habitación.",
        "availability",
        availabilityRevision,
      ));
    }
  }

  const quoteRef = (step.kind === "RESPOND" || step.kind === "COMPLETE")
    ? step.groundedReferences.find((reference): reference is Extract<GroundedReference, { kind: "quote" }> => reference.kind === "quote")
    : undefined;
  if (quoteRef && state.quote.status === "observed" && state.quote.observationRevision === quoteRef.observationRevision
    && state.quote.amountCents !== undefined && state.quote.currency) {
    facts.push(fact("quote_total", "money", money(state.quote.amountCents, state.quote.currency), "quote", quoteRef.observationRevision));
  }

  if (step.kind === "COMPLETE") {
    facts.push(fact("operation_status", "status", "confirmada", "execution"));
  }
  if (step.kind === "DEGRADE" && step.responseIntent === "operation_failed") {
    const partial = state.execution.outcomeKind === "booking_created_partial" || state.execution.outcomeKind === "booking_cancelled_partial";
    facts.push(fact("operation_status", "status", partial ? "parcial" : "fallida", "execution"));
  }

  if (step.kind === "RESPOND" || step.kind === "COMPLETE") {
    for (const reference of step.groundedReferences) {
      if (reference.kind !== "booking") continue;
      const booking = state.bookings.find((item) => item.bookingId === reference.bookingId);
      if (booking) facts.push(fact(`booking_${facts.length + 1}`, "booking_code", booking.bookingId, "booking", booking.observationRevision));
    }
  }

  return facts;
}

function questionSpec(step: Readonly<NextStep>): ResponseQuestionSpec | undefined {
  return step.kind === "ASK" ? { field: step.field, reason: step.reason } : undefined;
}

function criticalActionSpec(state: Readonly<TaskStateV1>, purpose: ResponsePurpose): ResponseCriticalActionSpec | undefined {
  if (purpose === "approval_required") return { kind: "approval_required" };
  if (purpose === "success") return { kind: "success" };
  if (purpose === "failure") {
    const partial = state.execution.outcomeKind === "booking_created_partial" || state.execution.outcomeKind === "booking_cancelled_partial";
    return { kind: "failure", ...(partial ? { partial: true } : {}) };
  }
  return undefined;
}

function anchorCandidate(
  responseId: string,
  fingerprint: string,
  step: Readonly<NextStep>,
  entities: readonly ResponsePresentationEntity[],
): DialogueAnchorCandidate | undefined {
  if (step.kind === "ASK") {
    return {
      responseId,
      responseDependencyFingerprint: fingerprint,
      anchor: {
        kind: step.dialogueAnchorSpec.kind,
        ...(entities.length > 0 ? { presentedEntities: entities.map((entity) => structuredClone(entity)) } : {}),
        lastQuestionPurpose: step.field,
      },
    };
  }
  if (entities.length > 0) {
    return {
      responseId,
      responseDependencyFingerprint: fingerprint,
      anchor: { kind: "selection", presentedEntities: entities.map((entity) => structuredClone(entity)) },
    };
  }
  return undefined;
}

function pendingClarificationCandidate(
  responseId: string,
  fingerprint: string,
  step: Readonly<NextStep>,
): PendingClarificationCandidate | undefined {
  if (step.kind !== "ASK") return undefined;
  return {
    responseId,
    responseDependencyFingerprint: fingerprint,
    field: step.field,
    reason: step.reason,
  };
}

export async function buildResponsePublicationCandidate(input: {
  state: Readonly<TaskStateV1>;
  nextStep: Readonly<NextStep>;
  responseId: string;
  locale?: string;
  toneProfile?: string;
}): Promise<ResponseBuildResult> {
  if (!input.responseId.trim()) return { ok: false, failureCode: "RESPONSE_ID_REQUIRED" };
  const purpose = purposeForStep(input.nextStep);
  if (!purpose) return { ok: false, failureCode: "NEXT_STEP_NOT_RESPONSEABLE" };
  const projection = responseDependencyProjection(input.state, input.nextStep);
  if (!projection) return { ok: false, failureCode: "RESPONSE_GROUNDING_INVALID" };
  const fingerprint = await opaqueResponseFingerprint(projection);
  const entities = presentationEntitiesForStep(input.state, input.nextStep);
  if (!entities) return { ok: false, failureCode: "RESPONSE_PRESENTATION_GROUNDING_INVALID" };
  const facts = factsForStep(input.state, input.nextStep);
  const question = questionSpec(input.nextStep);
  const critical = criticalActionSpec(input.state, purpose);
  const context: ResponseContext = {
    responseId: input.responseId,
    purpose,
    taskId: input.state.taskId,
    stateRevision: input.state.stateRevision,
    responseDependencyFingerprint: fingerprint,
    renderingMode: renderingMode(purpose),
    groundedFacts: facts,
    presentationEntities: entities,
    ...(question ? { questionSpec: question } : {}),
    ...(critical ? { criticalActionSpec: critical } : {}),
    taskSummary: {
      ...(input.state.requestedGoal ? { goal: input.state.requestedGoal.value } : {}),
      ...(input.state.requestedStay.checkIn ? { checkIn: input.state.requestedStay.checkIn.value } : {}),
      ...(input.state.requestedStay.checkOut ? { checkOut: input.state.requestedStay.checkOut.value } : {}),
      ...(input.state.requestedStay.guests ? { guests: input.state.requestedStay.guests.value } : {}),
    },
    locale: input.locale ?? "es-AR",
    toneProfile: input.toneProfile ?? "concise_receptionist",
    assertionPolicy: {
      allowedFactIds: facts.map((item) => item.factId),
      ...(question ? { questionField: question.field } : {}),
      allowSuccessClaim: purpose === "success",
      allowFailureClaim: purpose === "failure",
    },
  };
  const anchor = anchorCandidate(input.responseId, fingerprint, input.nextStep, entities);
  const pending = pendingClarificationCandidate(input.responseId, fingerprint, input.nextStep);
  return {
    ok: true,
    candidate: {
      taskId: input.state.taskId,
      sessionId: input.state.sessionId,
      builtAtStateRevision: input.state.stateRevision,
      nextStep: structuredClone(input.nextStep),
      responseDependencyFingerprint: fingerprint,
      context,
      ...(anchor ? { dialogueAnchorCandidate: anchor } : {}),
      ...(pending ? { pendingClarificationCandidate: pending } : {}),
    },
  };
}

function questionText(field: AskField): string {
  switch (field) {
    case "dates": return "¿Para qué fechas necesitás la estadía?";
    case "check_in": return "¿Qué fecha de ingreso necesitás?";
    case "check_out": return "¿Qué fecha de salida necesitás?";
    case "guests": return "¿Para cuántos huéspedes es la estadía?";
    case "selection": return "¿Cuál preferís?";
    case "booking_reference": return "¿Qué reserva querés gestionar?";
    case "retry_target": return "¿Qué consulta querés volver a intentar?";
  }
}

function optionsText(context: Readonly<ResponseContext>): string {
  if (context.presentationEntities.length === 0) return "";
  return context.presentationEntities.map((entity) => {
    if (entity.entityType === "room") {
      const name = entity.roomNumber ? `habitación ${entity.roomNumber}` : `opción ${entity.ordinal}`;
      return `${entity.ordinal}. ${name}${entity.label ? ` (${entity.label})` : ""}`;
    }
    return `${entity.ordinal}. reserva ${entity.bookingCode ?? entity.ordinal}`;
  }).join("; ");
}

export function renderOperationalResponse(context: Readonly<ResponseContext>): string {
  const options = optionsText(context);
  const limitation = context.groundedFacts.find((item) => item.factId === "guest_capacity_limitation")?.displayValue;
  const quote = context.groundedFacts.find((item) => item.factId === "quote_total")?.displayValue;
  const bookingCodes = context.groundedFacts.filter((item) => item.type === "booking_code").map((item) => item.displayValue);

  if (context.questionSpec) {
    const question = questionText(context.questionSpec.field);
    return [options ? `Opciones: ${options}.` : "", limitation ?? "", question].filter(Boolean).join(" ");
  }
  switch (context.purpose) {
    case "present_options": return [options ? `Opciones disponibles: ${options}.` : "Hay opciones disponibles.", limitation ?? ""].filter(Boolean).join(" ");
    case "approval_required": return "La operación requiere aprobación antes de ejecutarse.";
    case "success": return bookingCodes.length > 0
      ? `La operación quedó confirmada. Código${bookingCodes.length === 1 ? "" : "s"}: ${bookingCodes.join(", ")}.`
      : "La operación quedó confirmada.";
    case "failure": return context.criticalActionSpec?.partial
      ? "La operación quedó parcialmente completada y requiere revisión."
      : "La operación no pudo completarse.";
    case "no_results": return "No encontré habitaciones disponibles para esas fechas.";
    case "unsupported": return "Esa operación no está disponible en esta versión.";
    case "degrade": return "No puedo continuar con seguridad con esa solicitud.";
    case "acknowledge": return quote ? `La cotización total es ${quote}.` : "Entendido.";
    case "ask": return "Necesito un dato adicional para continuar.";
  }
}

export async function admitResponseForPublication(
  candidate: Readonly<ResponsePublicationCandidate>,
  currentState: Readonly<TaskStateV1>,
): Promise<ResponseAdmissionResult> {
  if (candidate.taskId !== currentState.taskId || candidate.sessionId !== currentState.sessionId) {
    return { ok: false, failureCode: "RESPONSE_TASK_SCOPE_MISMATCH" };
  }
  const projection = responseDependencyProjection(currentState, candidate.nextStep);
  if (!projection) return { ok: false, failureCode: "RESPONSE_DEPENDENCY_STALE" };
  const currentFingerprint = await opaqueResponseFingerprint(projection);
  if (currentFingerprint !== candidate.responseDependencyFingerprint) {
    return { ok: false, failureCode: "RESPONSE_DEPENDENCY_STALE" };
  }
  return {
    ok: true,
    admission: {
      candidate: structuredClone(candidate),
      expectedStateRevision: currentState.stateRevision,
      revisionChangedSinceBuild: currentState.stateRevision !== candidate.builtAtStateRevision,
    },
  };
}

export function commitAcceptedPublication(input: {
  state: Readonly<TaskStateV1>;
  admission: Readonly<ResponsePublicationAdmission>;
  eventId: string;
  publishedAt: string;
  channelAccepted: boolean;
}): ResponseCommitResult {
  if (!input.channelAccepted) return { ok: false, failureCode: "OUTPUT_NOT_ACCEPTED" };
  const candidate = input.admission.candidate;
  if (!input.eventId.trim() || !input.publishedAt.trim()) return { ok: false, failureCode: "PUBLICATION_META_INVALID" };
  const event: ResponsePublishedEvent = {
    kind: "response_published",
    eventId: input.eventId,
    taskId: candidate.taskId,
    sessionId: candidate.sessionId,
    expectedStateRevision: input.admission.expectedStateRevision,
    responseId: candidate.context.responseId,
    responseDependencyFingerprint: candidate.responseDependencyFingerprint,
    publishedAt: input.publishedAt,
    ...(candidate.dialogueAnchorCandidate ? { dialogueAnchor: structuredClone(candidate.dialogueAnchorCandidate.anchor) } : {}),
    ...(candidate.pendingClarificationCandidate ? { pendingClarification: structuredClone(candidate.pendingClarificationCandidate) } : {}),
  };
  const reduction = reduceTaskState(input.state, event);
  if (!reduction.accepted) {
    return { ok: false, failureCode: `PUBLICATION_EVENT_REJECTED_${reduction.rejectionReason ?? "UNKNOWN"}`, reduction };
  }
  return { ok: true, event, reduction };
}
