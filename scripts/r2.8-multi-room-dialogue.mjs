#!/usr/bin/env node

const baseUrl = process.env.AI_COMMERCE_STAGING_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("AI_COMMERCE_STAGING_URL is required");

const start = process.env.R28_START ?? "2030-01-01";
const end = process.env.R28_END ?? "2030-01-03";

let requestSeq = 0;
const transcript = [];
const results = [];

async function chat(caseId, message, sessionId, { idempotent = false } = {}) {
  requestSeq += 1;
  const started = Date.now();
  const requestId = `r28-r4-${caseId.toLowerCase()}-${requestSeq}-${crypto.randomUUID()}`;
  const headers = {
    "content-type": "application/json",
    "x-request-id": requestId,
  };
  if (idempotent) headers["Idempotency-Key"] = `r28-r4-${caseId.toLowerCase()}-${crypto.randomUUID()}`;
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
  transcript.push(item);
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
function hasMutationResult(item) {
  const raw = JSON.stringify(item?.body ?? {});
  return /"(?:bookingId|createdBookingIds|cancelledBookingIds|failedBookingIds)"\s*:/i.test(raw);
}
function record(caseId, pass, reason, extra = {}) { results.push({ caseId, pass, reason, ...extra }); }

// C06 — fresh multi-room setup against the readiness-approved synthetic window.
const setup = await chat(
  "C06",
  "Hola. Somos cuatro y queremos quedarnos del 1 al 3 de enero de 2030. ¿Qué tenés disponible?",
);
const sessionId = setup.body?.sessionId;
const rooms = Array.isArray(setup.body?.data?.rooms) ? setup.body.data.rooms : [];
const roomNumbers = rooms.map((room) => String(room?.roomNumber ?? "")).filter(Boolean);
record(
  "C06",
  is2xx(setup)
    && Boolean(sessionId)
    && setup.body?.data?.source === "hms"
    && setup.body?.data?.truth === "transactional"
    && setup.body?.data?.start === start
    && setup.body?.data?.end === end
    && setup.body?.data?.requestedGuests === 4
    && roomNumbers.includes("101")
    && roomNumbers.includes("102")
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
const c07LanguageSafe = !asksGuests(selectionText)
  && !asksDates(selectionText)
  && !staleUnsupported(selectionText)
  && !hasInternalLeak(selectionText)
  && !inventedPayment(selectionText);

let boundary = approvalRequired(selection) ? selection : null;
let occupancy = null;
let probe = null;

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

// Historical R2.4 wording probe: if the first natural selection did not already
// reach HITL, ask to reserve the already-selected pair. The expected server-side
// path is the R2.5 composite tool, never a single-room collapse. We only issue the
// challenge; /api/approve is intentionally not called in this block.
if (!boundary) {
  probe = await chat("R2.8.4-HISTORICAL-PROBE", "Perfecto, reservá esas dos.", sessionId, { idempotent: true });
  boundary = approvalRequired(probe) ? probe : null;
}

record(
  "C07",
  c07LanguageSafe
    && (is2xx(selection) || approvalRequired(selection))
    && Boolean(boundary)
    && !hasMutationResult(selection)
    && !hasMutationResult(occupancy)
    && !hasMutationResult(probe),
  "natural 101+102 intent remains multi-room and reaches unconsumed HITL boundary",
  {
    assistant: selectionText,
    selectionStatus: selection.status,
    reachedApprovalAt: boundary?.caseId ?? null,
    approvalSummary: boundary?.body?.approvalSummary ?? null,
    approvalSummaryHasUuid: hasUuid(boundary?.body?.approvalSummary ?? ""),
    latencyMs: selection.latencyMs,
  },
);

record(
  "R2.8.4-HISTORICAL-PROBE",
  Boolean(boundary) && !staleUnsupported(userFacing(boundary)),
  "real conversational path progresses beyond stale R2.4 assumptions to an approval boundary",
  { boundaryCaseId: boundary?.caseId ?? null, boundaryStatus: boundary?.status ?? null },
);

const mutationSignals = transcript.filter(hasMutationResult);
record(
  "R2.8.4-NO-MUTATION",
  mutationSignals.length === 0,
  "no booking/cancellation result exists because approval challenge was not consumed",
  { mutationSignals: mutationSignals.map((item) => item.caseId) },
);

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
    hmsMutationRequests: 0,
  },
  results,
  transcript,
};
console.log(JSON.stringify(report, null, 2));
if (failed.length > 0) process.exit(1);
