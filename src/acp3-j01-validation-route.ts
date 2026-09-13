import type { ModelProvider } from "./core/model-provider.js";
import { HotelTaskPlanner } from "./core/hotel-task-planner.js";
import { HOTEL_TASK_DEFINITION_V1, buildHotelDomainCapabilities } from "./core/planning.js";
import { runJ01ProviderSemanticPreflight } from "./core/j01-provider-preflight.js";
import type { TaskStateV1 } from "./core/task-state.js";

export const ACP3_J01_PROVIDER_PREFLIGHT_PATH = "/__validation/acp3/j01-provider-preflight";
const FIXED_J01_MESSAGE = "Quiero reservar una habitación del 10 al 12 de febrero de 2027 para 2 personas.";

function cleanState(): TaskStateV1 {
  return {
    taskId: "validation-j01-task",
    sessionId: "validation-j01-session",
    taskType: "hotel_reservation_domain",
    lifecycle: "active",
    stateRevision: 0,
    recentEventIds: [],
    requestedStay: {},
    preferences: [],
    availability: { status: "not_queried", rooms: [], dependencyKeys: [] },
    quote: { status: "not_queried", roomIds: [], dependencyKeys: [] },
    groundedSelection: { status: "none", roomIds: [], dependencyKeys: [] },
    bookings: [],
    execution: { status: "not_started" },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Validation-only endpoint. Admission/authentication happens in worker.ts
 * before this function is called. The request cannot choose the prompt, state,
 * capabilities, tool IDs or any operational identifier.
 */
export async function handleAcp3J01ProviderPreflightRequest(
  request: Request,
  provider: ModelProvider,
  trustedNow = new Date().toISOString(),
): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { ok: false, failureCode: "J01_PREFLIGHT_METHOD_NOT_ALLOWED" });
  }
  const body = await request.text();
  if (body.trim().length > 0) {
    return json(400, { ok: false, failureCode: "J01_PREFLIGHT_BODY_NOT_ALLOWED" });
  }

  const result = await runJ01ProviderSemanticPreflight({
    state: cleanState(),
    userMessage: FIXED_J01_MESSAGE,
    temporalContext: {
      trustedNow,
      timezone: "America/Argentina/Mendoza",
      locale: "es-AR",
      calendarPolicyId: "gregorian",
      temporalPolicyVersion: "1",
    },
    provider,
    planner: new HotelTaskPlanner(),
    taskDefinition: HOTEL_TASK_DEFINITION_V1,
    capabilities: buildHotelDomainCapabilities([
      "hms.checkAvailability",
      "hms.getQuote",
      "hms.createReservation",
      "hms.createMultiReservation",
      "hms.cancelReservation",
      "hms.cancelMultiReservation",
    ]),
    meta: {
      eventId: "validation-j01-provider-semantic-turn",
      sourceRevision: 1,
    },
  });

  if (!result.ok) {
    const status = result.failureCode === "J01_PREFLIGHT_PROVIDER_FAILURE" ? 502 : 422;
    return json(status, {
      ok: false,
      failureCode: result.failureCode,
      ...(result.providerCategory ? { providerCategory: result.providerCategory } : {}),
      ...(result.underlyingProviderCategory ? { underlyingProviderCategory: result.underlyingProviderCategory } : {}),
    });
  }

  return json(200, {
    ok: true,
    kind: "ACP3_J01_PROVIDER_PREFLIGHT_PASS",
    nextStep: {
      kind: result.nextStep.kind,
      capabilityId: result.nextStep.capabilityId,
      effectClass: result.nextStep.effectClass,
      groundedInput: result.nextStep.groundedInput,
    },
    receipt: result.receipt,
    operationalState: {
      pendingToolInvocation: false,
      preparedOperation: false,
      executionStatus: result.nextState.execution.status,
    },
  });
}
