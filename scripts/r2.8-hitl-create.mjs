#!/usr/bin/env node

const baseUrl = process.env.AI_COMMERCE_STAGING_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("AI_COMMERCE_STAGING_URL is required");

const start = process.env.R28_START ?? "2030-01-01";
const end = process.env.R28_END ?? "2030-01-03";
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
let seq = 0;
const transcript = [];
const results = [];
let sessionId;
let createBoundary;
let created = false;
let cleanup = { attempted: false, passed: false, detail: "not required" };

async function call(path, caseId, { message, sessionId: session, key, approvalToken } = {}) {
  seq += 1;
  const started = Date.now();
  const requestId = `r28-r5-${caseId.toLowerCase()}-${seq}-${crypto.randomUUID()}`;
  const headers = { "content-type": "application/json", "x-request-id": requestId };
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, ...(session ? { sessionId: session } : {}), ...(approvalToken ? { approvalToken } : {}) }),
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { body = { raw }; }
  const item = { caseId, path, requestId, user: message, status: response.status, body, latencyMs: Date.now() - started, key: key ?? null };
  transcript.push(item);
  return item;
}

function record(caseId, pass, reason, extra = {}) { results.push({ caseId, pass, reason, ...extra }); }
function approvalRequired(item) {
  return item?.status === 409 && item?.body?.error?.code === "APPROVAL_REQUIRED" && typeof item?.body?.approvalToken === "string" && Boolean(item.body.approvalToken);
}
function text(item) { return String(item?.body?.message ?? item?.body?.approvalSummary ?? item?.body?.error?.message ?? ""); }
function roomNumbers(item) {
  return Array.isArray(item?.body?.data?.rooms) ? item.body.data.rooms.map((room) => String(room?.roomNumber ?? "")).filter(Boolean) : [];
}
function bookingIds(item) {
  return Array.isArray(item?.body?.data?.bookingIds) ? item.body.data.bookingIds.filter((value) => typeof value === "string") : [];
}
function mutationBody(item) { return /"(?:bookingId|bookingIds|createdBookingIds|cancelledBookingIds)"\s*:/.test(JSON.stringify(item?.body ?? {})); }

async function availability(caseId) {
  return call("/api/chat", caseId, { message: "Hola. Somos cuatro y queremos quedarnos del 1 al 3 de enero de 2030. ¿Qué tenés disponible?" });
}

async function bestEffortCleanup() {
  if (!created || !sessionId) return;
  cleanup.attempted = true;
  try {
    const key = `r28-r5-cleanup-${crypto.randomUUID()}`;
    const pending = await call("/api/chat", "R2.8.5-CLEANUP-CHALLENGE", { message: "Cancelá todas las reservas de este grupo.", sessionId, key });
    if (!approvalRequired(pending)) throw new Error(`cleanup did not reach approval boundary (${pending.status})`);
    const approved = await call("/api/approve", "R2.8.5-CLEANUP-APPROVE", {
      message: "Cancelá todas las reservas de este grupo.",
      sessionId,
      key,
      approvalToken: pending.body.approvalToken,
    });
    if (approved.status !== 200) throw new Error(`cleanup approval failed (${approved.status})`);
    const restored = await availability("R2.8.5-CLEANUP-VERIFY");
    const numbers = roomNumbers(restored);
    cleanup = { attempted: true, passed: numbers.includes("101") && numbers.includes("102"), detail: `restored rooms: ${numbers.join(",")}` };
  } catch (error) {
    cleanup = { attempted: true, passed: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

try {
  const setup = await availability("C06");
  sessionId = setup.body?.sessionId;
  const initialRooms = roomNumbers(setup);
  record("C06", setup.status === 200 && Boolean(sessionId) && setup.body?.data?.truth === "transactional" && initialRooms.includes("101") && initialRooms.includes("102"), "authoritative staging window starts with 101+102 available", { initialRooms, latencyMs: setup.latencyMs });
  if (!sessionId) throw new Error("C06 did not establish session");

  const createKey = `r28-r5-create-${crypto.randomUUID()}`;
  const selection = await call("/api/chat", "C07", { message: "Quiero reservar la 101 y la 102.", sessionId, key: createKey });
  createBoundary = approvalRequired(selection) ? selection : null;
  if (!createBoundary && selection.status === 200 && /repart|distribu|ocupaci[oó]n|cada habitaci[oó]n/i.test(text(selection))) {
    const occupancy = await call("/api/chat", "C08", { message: "Dos en cada habitación.", sessionId, key: createKey });
    createBoundary = approvalRequired(occupancy) ? occupancy : null;
  }
  if (!createBoundary) {
    const probe = await call("/api/chat", "C09-PROBE", { message: "Perfecto, reservá esas dos.", sessionId, key: createKey });
    createBoundary = approvalRequired(probe) ? probe : null;
  }

  const summary = String(createBoundary?.body?.approvalSummary ?? "");
  record("C09", Boolean(createBoundary) && /101/.test(summary) && /102/.test(summary) && summary.includes(start) && summary.includes(end) && !uuidPattern.test(summary), "HITL challenge is exact and human-readable without UUID leakage", { approvalSummary: summary, reachedAt: createBoundary?.caseId ?? null });
  if (!createBoundary) throw new Error("C09 did not reach approval challenge");
  if (uuidPattern.test(summary)) throw new Error("C09 leaked canonical UUID in human approval summary");
  if (transcript.slice(0, -1).some(mutationBody)) throw new Error("mutation observed before approval");

  const approved = await call("/api/approve", "C10-CREATE", {
    message: createBoundary.user,
    sessionId,
    key: createBoundary.key,
    approvalToken: createBoundary.body.approvalToken,
  });
  const ids = bookingIds(approved);
  created = approved.status === 200 && approved.body?.data?.outcome === "confirmed" && ids.length === 2;
  record("C10-CREATE", created, "exact approved composite plan creates exactly two confirmed bookings", { bookingIds: ids, outcome: approved.body?.data?.outcome ?? null, latencyMs: approved.latencyMs });
  if (!created) throw new Error(`C10 create failed (${approved.status})`);

  const occupied = await availability("C10-VERIFY-ACTIVE");
  const availableAfterCreate = roomNumbers(occupied);
  record("C10-VERIFY-ACTIVE", occupied.status === 200 && !availableAfterCreate.includes("101") && !availableAfterCreate.includes("102"), "authoritative HMS availability excludes both newly booked rooms", { availableAfterCreate });

  const replay = await call("/api/approve", "C10-REPLAY-GUARD", {
    message: createBoundary.user,
    sessionId,
    key: createBoundary.key,
    approvalToken: createBoundary.body.approvalToken,
  });
  record("C10-REPLAY-GUARD", replay.status === 403 && replay.body?.error?.code === "FORBIDDEN", "single-use HITL token rejects replay before duplicate side effect; Core idempotency remains covered by foundation regression", { status: replay.status, code: replay.body?.error?.code ?? null });
} catch (error) {
  record("R2.8.5-RUNTIME", false, error instanceof Error ? error.message : String(error));
} finally {
  await bestEffortCleanup();
  record("R2.8.5-CLEANUP", !created || cleanup.passed, "run-created bookings are removed before gate completion", cleanup);
}

const failed = results.filter((item) => !item.pass);
const latencies = transcript.map((item) => item.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
const p95LatencyMs = latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] : null;
const report = {
  event: failed.length === 0 ? "ACP_R2_8_5_CREATE_PASS" : "ACP_R2_8_5_CREATE_FAIL",
  block: "R2.8.5",
  baseUrl,
  sessionId,
  window: { start, end },
  summary: { passed: results.length - failed.length, total: results.length, requests: seq, p95LatencyMs, created, cleanup },
  results,
  transcript,
};
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
