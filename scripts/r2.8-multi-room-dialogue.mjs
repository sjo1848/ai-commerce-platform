#!/usr/bin/env node
import { proveValidationTurn } from "./r2.8-validation-turn-proof.mjs";
import { validationRequestHeaders } from "./validation-request-headers.mjs";

const baseUrl = process.env.AI_COMMERCE_STAGING_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("AI_COMMERCE_STAGING_URL is required");

const start = process.env.R28_START ?? "2030-01-01";
const end = process.env.R28_END ?? "2030-01-03";

let requestSeq = 0;
function exactFinalPlan(item, ids, occupancyRequired) {
  const plan = item?.body?.approvalPlan, context = item?.body?.approvalContext;
  const allocation = context?.roomOccupancy ?? [];
  return plan?.toolId === "hms.createMultiReservation"
    && uniqueExactSet(ids, plan?.input?.roomIds ?? [])
    && plan.input.checkIn === start && plan.input.checkOut === end
    && context?.stay?.checkIn === start && context?.stay?.checkOut === end && context?.stay?.guests === 4
    && uniqueExactSet(ids, context?.selectedRoomIds ?? [])
    && (!occupancyRequired && allocation.length === 0 || uniqueExactSet(ids, allocation.map(x => x.roomId)) && allocation.every(x => x.guests === 2));
}
const transcript = [];
const results = [];

// Live tail correlation is useful evidence, but it is an observability
// transport concern. The direct response predicates below remain the
// functional acceptance boundary; an unavailable per-turn tail is explicit
// unknown evidence, never inferred as zero model/fallback activity.
async function supplementalRouteProof(requestId, sessionId) {
  try {
    return { status: "AVAILABLE", ...(await proveValidationTurn(requestId, sessionId)) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Only the proof helper's explicit absence classification is supplemental.
    // A correlated completed envelope that disproves the route contract remains
    // captured negative evidence and must stop this runner.
    return reason.startsWith("UNKNOWN:")
      ? { status: "UNKNOWN_NOT_CAPTURED" }
      : { status: "CAPTURED_INVALID", reason };
  }
}

async function chat(caseId, message, sessionId, { idempotent = false } = {}) {
  requestSeq += 1;
  const started = Date.now();
  const requestId = `r28-r4-${caseId.toLowerCase()}-${requestSeq}-${crypto.randomUUID()}`;
  let headers = {
    "content-type": "application/json",
    "x-request-id": requestId,
  };
  if (idempotent) headers["Idempotency-Key"] = `r28-r4-${caseId.toLowerCase()}-${crypto.randomUUID()}`;
  headers = validationRequestHeaders(headers);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { body = { raw }; }
  const item = {
    caseId,
    requestId,
    user: message,
    status: response.status,
    body,
    latencyMs: Date.now() - started,
  };
  const runtimeVersion = response.headers.get("x-acp-validation-runtime-version");
  if (process.env.R28_VERSION_ID && runtimeVersion !== process.env.R28_VERSION_ID) throw Error(`${caseId}: missing or mismatched direct runtime version proof`);
  if (runtimeVersion) item.runtimeVersion = runtimeVersion;
  transcript.push(item);
  if (sessionId && body.sessionId !== sessionId) throw Error(`${caseId}: session identity changed`);
  if (hasMutationResult(item)) throw Error(`${caseId}: response contained mutation result`);
  const route = body?.validationRouteProvenance?.route;
  if (route === "deterministic_fallback") throw Error(`${caseId}: direct validation receipt reports deterministic fallback`);
  if (route !== "baseline_llm") throw Error(`${caseId}: missing or invalid direct baseline route receipt`);
  item.routeProof = await supplementalRouteProof(requestId, body.sessionId);
  if (item.routeProof.status === "CAPTURED_INVALID") throw Error(`${caseId}: captured route proof invalid: ${item.routeProof.reason}`);
  return item;
}

function userFacing(item) {
  return String(item?.body?.message ?? item?.body?.approvalSummary ?? item?.body?.error?.message ?? "");
}
function is2xx(item) { return item.status >= 200 && item.status < 300; }
function asksGuests(text) { return /(?:cu[aá]ntas?\s+personas|hu[eé]spedes?|pax)/i.test(String(text)); }
function asksDates(text) { return /(?:fecha(?:s)?|cu[aá]ndo|qu[eé]\s+d[ií]a(?:s)?|entrada|salida)/i.test(String(text)); }
function asksOccupancy(text) { return /(?:repart|distribu|ocupaci[oó]n|cu[aá]nt[oa]s?.*(?:cada|habitaci[oó]n)|personas?.*(?:cada|habitaci[oó]n))/i.test(String(text)); }
function hasInternalLeak(text) { return /(?:\bhms\.|\btool\b|\bjson\b|\buuid\b|tenantid|hotelid|policy engine|operationtoken|approvaltoken|schema)/i.test(String(text)); }
function hasUuid(text) { return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(String(text)); }
function inventedPayment(text) { return /\b(?:tarjeta|efectivo|transferencia|seña|dep[oó]sito)\b/i.test(String(text)); }
function staleUnsupported(text) {
  const value = String(text);
  return /(?:no\s+(?:est[aá]|est[aá]n)\s+habilitad[oa]s?|todav[ií]a\s+no\s+(?:est[aá]|se\s+puede)|no\s+puedo[^.!?]{0,80}(?:dos|varias|m[uú]ltiples)[^.!?]{0,30}habit|una\s+sola\s+habitaci[oó]n|reserva\s+conjunta[^.!?]{0,40}no)/i.test(value);
}
function approvalRequired(item) {
  return item?.status === 409
    && item?.body?.error?.code === "APPROVAL_REQUIRED"
    && typeof item?.body?.approvalToken === "string"
    && Boolean(item.body.approvalToken);
}
function reportSafe(value) {
  if (Array.isArray(value)) return value.map(reportSafe);
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    if (/approval.*token/i.test(key)) {
      copy.approvalTokenPresent = Boolean(child);
    } else {
      copy[key] = reportSafe(child);
    }
  }
  return copy;
}
function hasMutationResult(item) {
  const raw = JSON.stringify(item?.body ?? {});
  return /"(?:bookingId|createdBookingIds|cancelledBookingIds|failedBookingIds)"\s*:/i.test(raw);
}
function uniqueExactSet(expected, actual) {
  const left = [...new Set(expected)]; const right = [...new Set(actual)];
  return left.length === expected.length && right.length === actual.length && left.length === right.length && left.every((value) => right.includes(value));
}
function approvalRoomIds(item) { return String(item?.body?.approvalSummary ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []; }
function record(caseId, pass, reason, extra = {}) { results.push({ caseId, pass, reason, ...extra }); if (!pass) throw new Error(`${caseId}: ${reason}`); }
let sessionId, boundary, occupancy;
try {

// C06 — fresh multi-room setup against the readiness-approved synthetic window.
const setup = await chat(
  "C06",
  "Hola. Somos cuatro y queremos quedarnos del 1 al 3 de enero de 2030. ¿Qué tenés disponible?",
);
sessionId = setup.body?.sessionId;
const rooms = Array.isArray(setup.body?.data?.rooms) ? setup.body.data.rooms : [];
const roomNumbers = rooms.map((room) => String(room?.roomNumber ?? "")).filter(Boolean);
const expectedRooms = ["101", "102"].map((number) => rooms.filter((room) => String(room?.roomNumber) === number));
const expectedRoomIds = expectedRooms.map((matches) => matches.length === 1 ? matches[0].id : undefined);
const c06ExactSetValid = expectedRoomIds.every(Boolean) && uniqueExactSet(expectedRoomIds, expectedRoomIds);
record(
  "C06",
  is2xx(setup)
    && Boolean(sessionId)
    && setup.body?.data?.source === "hms"
    && setup.body?.data?.truth === "transactional"
    && setup.body?.data?.start === start
    && setup.body?.data?.end === end
    && setup.body?.data?.requestedGuests === 4
    && c06ExactSetValid
    && !hasInternalLeak(userFacing(setup))
    && !hasUuid(userFacing(setup))
    && !inventedPayment(userFacing(setup)),
  "four guests + dates persisted; readiness-approved 101 and 102 visible from HMS",
  { assistant: userFacing(setup), roomNumbers, latencyMs: setup.latencyMs },
);
if (!sessionId) throw new Error("C06 did not establish a durable multi-room session");

// C07 — exact natural 101+102 reservation intent. Reaching HITL is allowed;
// the token is deliberately never consumed in R2.8.4, so no side effect occurs.
const selection = await chat("C07", "Quiero reservar la 101 y la 102.", sessionId, { idempotent: true });
const selectionText = userFacing(selection);
const c07LanguageSafe = (!asksGuests(selectionText) || asksOccupancy(selectionText))
  && !asksDates(selectionText)
  && !staleUnsupported(selectionText)
  && !hasInternalLeak(selectionText)
  && !inventedPayment(selectionText);

boundary = approvalRequired(selection) ? selection : null;
occupancy = null;
record("C07-SELECTION", c07LanguageSafe && !hasMutationResult(selection) && (Boolean(boundary) || (is2xx(selection) && selection.body?.outcome === "clarification" && JSON.stringify(selection.body?.missing) === JSON.stringify(["occupancy"]))), "only immediate HITL or explicit occupancy clarification is allowed");

if (!boundary && is2xx(selection) && asksOccupancy(selectionText)) {
  occupancy = await chat("C08", "Dos en cada habitación.", sessionId);
  const occupancyText = userFacing(occupancy);
  record(
    "C08",
    (is2xx(occupancy) || approvalRequired(occupancy))
      && !asksGuests(occupancyText)
      && !asksDates(occupancyText)
      && !staleUnsupported(occupancyText)
      && !hasInternalLeak(occupancyText)
      && !inventedPayment(occupancyText)
      && !hasMutationResult(occupancy),
    "explicit 2+2 occupancy accepted without stale-state or unsupported response",
    { assistant: occupancyText, status: occupancy.status, latencyMs: occupancy.latencyMs },
  );
  if (approvalRequired(occupancy)) boundary = occupancy;
} else {
  record(
    "C08",
    true,
    boundary ? "not required: exact C07 intent reached HITL directly" : "not required by the current canonical multi-room state",
    { applicable: false },
  );
}


record(
  "C07",
  c07LanguageSafe
    && (is2xx(selection) || approvalRequired(selection))
    && Boolean(boundary)
    && uniqueExactSet(expectedRoomIds, approvalRoomIds(boundary))
    && !hasMutationResult(selection)
    && !hasMutationResult(occupancy)
    && exactFinalPlan(boundary, expectedRoomIds, Boolean(occupancy)),
  "natural 101+102 intent remains multi-room and reaches unconsumed HITL boundary",
  {
    assistant: selectionText,
    selectionStatus: selection.status,
    reachedApprovalAt: boundary?.caseId ?? null,
    approvalSummary: boundary?.body?.approvalSummary ?? null,
    approvalSummaryHasUuid: hasUuid(boundary?.body?.approvalSummary ?? ""),
    expectedRoomNumbers: ["101", "102"],
    expectedRoomIds,
    approvalTargetsExact: Boolean(boundary) && uniqueExactSet(expectedRoomIds, approvalRoomIds(boundary)),
    latencyMs: selection.latencyMs,
  },
);

const mutationSignals = transcript.filter(hasMutationResult);
record(
  "R2.8.4-NO-MUTATION",
  mutationSignals.length === 0,
  "no booking/cancellation result exists because approval challenge was not consumed",
  { mutationSignals: mutationSignals.map((item) => item.caseId) },
);

} catch (error) { if (!results.some(item => !item.pass)) results.push({caseId: "RUNNER", pass: false, reason: error.message}); }
const mutationSignals = transcript.filter(hasMutationResult);
const latencies = transcript.map((item) => item.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
const p95 = latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] : null;
const failed = results.filter((item) => !item.pass);
const report = {
  event: failed.length === 0 ? "ACP_R2_8_MULTI_ROOM_DIALOGUE_PASS" : "ACP_R2_8_MULTI_ROOM_DIALOGUE_FAIL",
  block: "R2.8.4",
  baseUrl,
  multiRoomSessionId: sessionId,
  window: { start, end },
  summary: {
    passed: results.length - failed.length,
    total: results.length,
    requests: requestSeq,
    p95LatencyMs: p95,
    reachedApprovalChallenge: Boolean(boundary),
    approvalConsumed: false,
    responseMutationSignals: mutationSignals.length,
    hmsMutations: "UNKNOWN_PENDING_AUDIT",
  },
  results,
  transcript: transcript.map(reportSafe),
};
console.log(JSON.stringify(report, null, 2));
if (failed.length > 0) process.exit(1);
