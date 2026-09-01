#!/usr/bin/env node

const baseUrl = process.env.AI_COMMERCE_STAGING_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("AI_COMMERCE_STAGING_URL is required");

const maxWindows = Number(process.env.R28_READINESS_MAX_WINDOWS ?? 24);
if (!Number.isInteger(maxWindows) || maxWindows < 1 || maxWindows > 60) throw new Error("R28_READINESS_MAX_WINDOWS must be 1..60");

let requestSeq = 0;
const observations = [];

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDays(date, days) { return iso(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000); }

async function postChat(message, sessionId) {
  requestSeq += 1;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": `r28-readiness-${requestSeq}-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`non-JSON HTTP ${response.status}: ${text.slice(0, 400)}`); }
  return { status: response.status, body };
}

const root = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(15_000) });
if (!root.ok) throw new Error(`root readiness failed HTTP ${root.status}`);

const greeting = await postChat("Hola");
if (greeting.status < 200 || greeting.status >= 300 || !greeting.body?.sessionId) {
  throw new Error(`greeting/session readiness failed: ${JSON.stringify(greeting)}`);
}
const sessionId = greeting.body.sessionId;

const guestKnown = await postChat("¿Tenés habitaciones para dos?", sessionId);
const guestMessage = String(guestKnown.body?.message ?? "");
if (guestKnown.status < 200 || guestKnown.status >= 300 || guestKnown.body?.data || !/fecha|cu[aá]ndo|d[ií]a/i.test(guestMessage)) {
  throw new Error(`guest-memory readiness did not safely clarify dates: ${JSON.stringify(guestKnown)}`);
}
if (/cu[aá]ntas?\s+personas|hu[eé]spedes|pax/i.test(guestMessage)) {
  throw new Error(`guest-memory readiness redundantly re-asked guest count: ${guestMessage}`);
}

let selected;
const base = Date.UTC(2030, 0, 1);
for (let i = 0; i < maxWindows; i += 1) {
  const start = iso(base + i * 7 * 86_400_000);
  const end = addDays(start, 2);
  const result = await postChat(`Para dos personas, ¿qué habitaciones tenés disponibles desde ${start} hasta ${end}?`, sessionId);
  const data = result.body?.data;
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  observations.push({ start, end, status: result.status, source: data?.source, truth: data?.truth, roomNumbers: rooms.map((room) => room?.roomNumber).filter(Boolean) });
  if (result.status < 200 || result.status >= 300 || data?.source !== "hms" || data?.truth !== "transactional") continue;
  const room101 = rooms.find((room) => String(room?.roomNumber) === "101");
  const room102 = rooms.find((room) => String(room?.roomNumber) === "102");
  if (room101?.id && room102?.id) {
    selected = {
      start,
      end,
      rooms: [
        { roomNumber: "101", roomId: room101.id },
        { roomNumber: "102", roomId: room102.id },
      ],
    };
    break;
  }
}

const report = {
  event: selected ? "ACP_R2_8_STAGING_READY_DATA" : "ACP_R2_8_STAGING_NOT_READY_DATA",
  baseUrl,
  sessionContinuity: true,
  requests: requestSeq,
  scanBound: maxWindows,
  selectedWindow: selected ?? null,
  observations,
  hmsMutationRequests: 0,
};
console.log(JSON.stringify(report, null, 2));

if (!selected) process.exit(2);
