#!/usr/bin/env node

const baseUrl = process.env.AI_COMMERCE_STAGING_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("AI_COMMERCE_STAGING_URL is required");

const start = process.env.R28_START ?? "2030-01-01";
const end = process.env.R28_END ?? "2030-01-03";
const correctedStart = process.env.R28_CORRECTED_START ?? "2030-01-02";
const correctedEnd = process.env.R28_CORRECTED_END ?? "2030-01-04";

let requestSeq = 0;
const transcript = [];
const results = [];

async function chat(caseId, message, sessionId) {
  requestSeq += 1;
  const started = Date.now();
  const requestId = `r28-r3-${caseId.toLowerCase()}-${requestSeq}-${crypto.randomUUID()}`;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
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

function visible(item) { return String(item?.body?.message ?? ""); }
function is2xx(item) { return item.status >= 200 && item.status < 300; }
function asksGuests(text) { return /(?:cu[aá]ntas?\s+personas|hu[eé]spedes?|pax)/i.test(String(text)); }
function asksDates(text) { return /(?:fecha(?:s)?|cu[aá]ndo|qu[eé]\s+d[ií]a(?:s)?|entrada|salida)/i.test(String(text)); }
function greetingLike(text) { return /(?:hola|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|bienvenid)/i.test(String(text)); }
function hasInternalLeak(text) { return /(?:\bhms\.|\btool\b|\bjson\b|\buuid\b|tenantid|hotelid|policy engine|operationtoken|approvaltoken|schema)/i.test(String(text)); }
function hasUuid(text) { return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(String(text)); }
function inventedPayment(text) { return /\b(?:tarjeta|efectivo|transferencia|seña|dep[oó]sito)\b/i.test(String(text)); }
function record(caseId, pass, reason, extra = {}) { results.push({ caseId, pass, reason, ...extra }); }

// C01 — greeting must remain conversational and tool-free from the guest's perspective.
const greeting = await chat("C01", "Hola");
record(
  "C01",
  is2xx(greeting) && Boolean(greeting.body?.sessionId) && !greeting.body?.data && greetingLike(visible(greeting)) && !hasInternalLeak(visible(greeting)) && !hasUuid(visible(greeting)) && !inventedPayment(visible(greeting)),
  "natural greeting without operational fact/tool facade",
  { assistant: visible(greeting), latencyMs: greeting.latencyMs },
);
const sessionId = greeting.body?.sessionId;
if (!sessionId) throw new Error("C01 did not establish a durable session");

// C02 — party size before dates: remember 2 and ask only for dates.
const partyFirst = await chat("C02", "¿Tenés habitaciones para dos?", sessionId);
record(
  "C02",
  is2xx(partyFirst) && !partyFirst.body?.data && asksDates(visible(partyFirst)) && !asksGuests(visible(partyFirst)) && !hasInternalLeak(visible(partyFirst)) && !hasUuid(visible(partyFirst)) && !inventedPayment(visible(partyFirst)),
  "guest count retained; only dates clarified",
  { assistant: visible(partyFirst), latencyMs: partyFirst.latencyMs },
);

// C03 — dates complete the stay and must query HMS with remembered guests=2.
const dates = await chat("C03", `Del 1 al 3 de enero de 2030.`, sessionId);
const c03Rooms = Array.isArray(dates.body?.data?.rooms) ? dates.body.data.rooms : [];
record(
  "C03",
  is2xx(dates)
    && dates.body?.data?.source === "hms"
    && dates.body?.data?.truth === "transactional"
    && dates.body?.data?.start === start
    && dates.body?.data?.end === end
    && dates.body?.data?.requestedGuests === 2
    && c03Rooms.length >= 2
    && !asksGuests(visible(dates))
    && !asksDates(visible(dates))
    && !hasInternalLeak(visible(dates))
    && !hasUuid(visible(dates))
    && !inventedPayment(visible(dates)),
  "remembered guests + authoritative HMS availability",
  { assistant: visible(dates), roomNumbers: c03Rooms.map((r) => r?.roomNumber).filter(Boolean), latencyMs: dates.latencyMs },
);

// C04 — explicit correction supersedes old dates and re-evaluates HMS truth.
const correction = await chat("C04", "Mejor corramos un día: del 2 al 4 de enero de 2030.", sessionId);
record(
  "C04",
  is2xx(correction)
    && correction.body?.data?.source === "hms"
    && correction.body?.data?.truth === "transactional"
    && correction.body?.data?.start === correctedStart
    && correction.body?.data?.end === correctedEnd
    && correction.body?.data?.requestedGuests === 2
    && !asksGuests(visible(correction))
    && !asksDates(visible(correction))
    && !hasInternalLeak(visible(correction))
    && !hasUuid(visible(correction))
    && !inventedPayment(visible(correction)),
  "corrected dates replace stale dates and preserve guests",
  { assistant: visible(correction), latencyMs: correction.latencyMs },
);

// C05 — fresh session, authoritative availability, then ordinal quote against current server order.
const freshAvailability = await chat("C05A", "Somos dos. Busco del 1 al 3 de enero de 2030. ¿Qué habitaciones tenés disponibles?");
const freshSessionId = freshAvailability.body?.sessionId;
const freshRooms = Array.isArray(freshAvailability.body?.data?.rooms) ? freshAvailability.body.data.rooms : [];
const firstRoomId = freshRooms[0]?.id;
const firstRoomNumber = freshRooms[0]?.roomNumber;
let ordinal;
if (freshSessionId && firstRoomId && freshRooms.length >= 2) ordinal = await chat("C05B", "¿Cuánto sale la primera?", freshSessionId);
record(
  "C05",
  Boolean(
    ordinal
    && is2xx(freshAvailability)
    && freshAvailability.body?.data?.source === "hms"
    && freshAvailability.body?.data?.truth === "transactional"
    && freshRooms.length >= 2
    && is2xx(ordinal)
    && ordinal.body?.data?.source === "hms"
    && ordinal.body?.data?.roomId === firstRoomId
    && Number.isInteger(ordinal.body?.data?.totalCents)
    && !hasInternalLeak(visible(ordinal))
    && !hasUuid(visible(ordinal))
    && !inventedPayment(visible(ordinal))
  ),
  "ordinal quote resolves against current authoritative availability order",
  { firstRoomNumber, assistant: visible(ordinal), latencyMs: ordinal?.latencyMs ?? null },
);

// Read-only safety envelope for this block.
const mutationSignals = transcript.filter((item) => /approvalToken|bookingId|reservationId|createdBookingIds|cancelledBookingIds/i.test(JSON.stringify(item.body ?? {})));
record("R2.8.3-NO-MUTATION", mutationSignals.length === 0, "conversation corpus produced no mutation/approval result", { mutationSignals: mutationSignals.map((x) => x.caseId) });

const latencies = transcript.map((x) => x.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
const p95 = latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] : null;
const failed = results.filter((x) => !x.pass);
const report = {
  event: failed.length === 0 ? "ACP_R2_8_CONVERSATION_PASS" : "ACP_R2_8_CONVERSATION_FAIL",
  block: "R2.8.3",
  baseUrl,
  window: { start, end, correctedStart, correctedEnd },
  summary: {
    passed: results.length - failed.length,
    total: results.length,
    p95LatencyMs: p95,
    requests: requestSeq,
    hmsMutationRequests: 0,
  },
  results,
  transcript,
};
console.log(JSON.stringify(report, null, 2));
if (failed.length > 0) process.exit(1);
