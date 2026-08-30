import assert from "node:assert/strict";

const baseUrl = process.env.AI_COMMERCE_STAGING_URL?.replace(/\/$/, "");
assert(baseUrl, "AI_COMMERCE_STAGING_URL is required");

// Staging guest identity is now server-bound from trusted tenant+actor context.
// This value is used only to verify the authoritative HMS result; it is never
// sent as model/user input.
const guestId = process.env.ACP25_GUEST_ID || "12000000-0000-0000-0000-000000000001";
const runId = process.env.GITHUB_RUN_ID || "local";
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || "1";
const prefix = `acp26-${runId}-${runAttempt}`;
let requestSeq = 0;

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date, days) {
  return isoDate(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
}

function deterministicDates() {
  const numeric = /^\d+$/.test(runId) ? BigInt(runId) : 0n;
  const attempt = /^\d+$/.test(runAttempt) ? BigInt(runAttempt) : 1n;
  const offsetDays = Number((numeric * 17n + attempt * 31n) % 1200n);
  const start = isoDate(Date.UTC(2030, 0, 1) + offsetDays * 86_400_000);
  return { start, end: addDays(start, 2) };
}

async function post(path, { message, sessionId, idempotencyKey, approvalToken }) {
  requestSeq += 1;
  const headers = {
    "content-type": "application/json",
    "x-request-id": `${prefix}-${requestSeq}`,
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      ...(sessionId ? { sessionId } : {}),
      ...(approvalToken ? { approvalToken } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return { status: response.status, body };
}

function assertHmsTransactional(data, label) {
  assert.equal(data?.source, "hms", `${label}: source must be HMS`);
  assert.equal(data?.truth, "transactional", `${label}: truth must be transactional`);
}

async function availability(message, sessionId) {
  const result = await post("/api/chat", { message, sessionId });
  assert.ok(result.status >= 200 && result.status < 300, `availability HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  assertHmsTransactional(result.body?.data, "availability");
  assert.ok(result.body?.sessionId, "availability missing sessionId");
  assert.ok(Array.isArray(result.body?.data?.rooms), "availability rooms missing");
  return result;
}

async function approvedMutation({ message, sessionId, idempotencyKey, expectedStatus = 200, expectedErrorCode }) {
  const challenge = await post("/api/chat", { message, sessionId, idempotencyKey });
  assert.equal(challenge.status, 409, `mutation must require approval first: ${JSON.stringify(challenge.body)}`);
  assert.equal(challenge.body?.error?.code, "APPROVAL_REQUIRED", `expected APPROVAL_REQUIRED: ${JSON.stringify(challenge.body)}`);
  assert.ok(challenge.body?.approvalToken, "approvalToken missing");
  assert.ok(challenge.body?.sessionId, "approval challenge missing sessionId");

  const approved = await post("/api/approve", {
    message,
    sessionId: challenge.body.sessionId,
    idempotencyKey,
    approvalToken: challenge.body.approvalToken,
  });

  if (expectedErrorCode) {
    assert.equal(approved.status, expectedStatus, `approved mutation HTTP ${approved.status}: ${JSON.stringify(approved.body)}`);
    assert.equal(approved.body?.error?.code, expectedErrorCode, `expected ${expectedErrorCode}: ${JSON.stringify(approved.body)}`);
  } else {
    assert.ok(approved.status >= 200 && approved.status < 300, `approved mutation HTTP ${approved.status}: ${JSON.stringify(approved.body)}`);
  }
  return approved;
}

const { start, end } = deterministicDates();
const createKey = `${prefix}-create`;
const cancelKey = `${prefix}-cancel`;
let sessionId;
let bookingId;
let roomId;
let cleanupComplete = false;
let primaryError;

try {
  const initial = await availability(`disponibilidad ${start} ${end} para 1 persona`);
  sessionId = initial.body.sessionId;
  assert.ok(initial.body.data.rooms.length > 0, `no HMS room available for synthetic window ${start}..${end}`);
  roomId = initial.body.data.rooms[0]?.id;
  assert.ok(roomId, "availability returned room without id");

  // No guest UUID is supplied. The canonical reservation plan must inject the
  // trusted staging guest identity from tenant+actor before HITL fingerprinting.
  const createMessage = `reservar habitación ${roomId} del ${start} al ${end}`;
  const created = await approvedMutation({ message: createMessage, sessionId, idempotencyKey: createKey });
  const createdData = created.body?.data;
  assertHmsTransactional(createdData, "create");
  assert.equal(createdData?.roomId, roomId, "create room mismatch");
  assert.equal(createdData?.guestId, guestId, "create must use server-bound guest identity");
  assert.equal(createdData?.start, start, "create start mismatch");
  assert.equal(createdData?.end, end, "create end mismatch");
  assert.equal(createdData?.status, "CONFIRMED", "create status mismatch");
  assert.equal(createdData?.replayed, false, "first create must not be replayed");
  assert.ok(Number.isInteger(createdData?.totalCents) && createdData.totalCents > 0, "create total invalid");
  assert.ok(typeof createdData?.bookingId === "string" && createdData.bookingId, "create bookingId missing");
  bookingId = createdData.bookingId;

  const replay = await approvedMutation({ message: createMessage, sessionId, idempotencyKey: createKey });
  assertHmsTransactional(replay.body?.data, "create replay");
  assert.equal(replay.body?.data?.bookingId, bookingId, "create replay booking mismatch");
  assert.equal(replay.body?.data?.replayed, true, "second create must be authoritative HMS replay");

  // Preserve the downstream idempotency conflict invariant without attempting
  // to spoof guest identity. Same operation token + different canonical dates
  // must conflict authoritatively in HMS.
  const conflictEnd = addDays(end, 1);
  const conflictMessage = `reservar habitación ${roomId} del ${start} al ${conflictEnd}`;
  await approvedMutation({
    message: conflictMessage,
    sessionId,
    idempotencyKey: createKey,
    expectedStatus: 409,
    expectedErrorCode: "CONFLICT",
  });

  const unavailable = await availability(`disponibilidad ${start} ${end} para 1 persona`, sessionId);
  assert.ok(!unavailable.body.data.rooms.some((room) => room?.id === roomId), "reserved room remained available");

  const cancelMessage = `cancelar reserva ${bookingId}`;
  const cancelled = await approvedMutation({ message: cancelMessage, sessionId, idempotencyKey: cancelKey });
  assertHmsTransactional(cancelled.body?.data, "cancel");
  assert.equal(cancelled.body?.data?.bookingId, bookingId, "cancel booking mismatch");
  assert.equal(cancelled.body?.data?.status, "CANCELLED", "cancel status mismatch");
  assert.equal(cancelled.body?.data?.replayed, false, "first cancel must not be replayed");

  const cancelReplay = await approvedMutation({ message: cancelMessage, sessionId, idempotencyKey: cancelKey });
  assertHmsTransactional(cancelReplay.body?.data, "cancel replay");
  assert.equal(cancelReplay.body?.data?.bookingId, bookingId, "cancel replay booking mismatch");
  assert.equal(cancelReplay.body?.data?.status, "CANCELLED", "cancel replay status mismatch");
  assert.equal(cancelReplay.body?.data?.replayed, true, "second cancel must be authoritative HMS replay");

  const restored = await availability(`disponibilidad ${start} ${end} para 1 persona`, sessionId);
  assert.ok(restored.body.data.rooms.some((room) => room?.id === roomId), "cancel cleanup did not restore room availability");
  cleanupComplete = true;

  console.log(JSON.stringify({
    event: "ACP_2_6_E2E_PASS",
    start,
    end,
    roomId,
    bookingId,
    guestIdentity: "server_bound",
    checks: [
      "hitl_required",
      "server_bound_guest_identity",
      "create",
      "authoritative_create_replay",
      "same_token_payload_conflict",
      "inventory_claim",
      "token_owned_cancel",
      "authoritative_cancel_replay",
      "inventory_restored",
    ],
  }));
} catch (error) {
  primaryError = error;
} finally {
  if (bookingId && sessionId && !cleanupComplete) {
    try {
      const cleanupMessage = `cancelar reserva ${bookingId}`;
      const cleanup = await approvedMutation({
        message: cleanupMessage,
        sessionId,
        idempotencyKey: `${prefix}-best-effort-cleanup`,
      });
      assertHmsTransactional(cleanup.body?.data, "best-effort cleanup");
      assert.equal(cleanup.body?.data?.bookingId, bookingId, "best-effort cleanup booking mismatch");
      assert.equal(cleanup.body?.data?.status, "CANCELLED", "best-effort cleanup status mismatch");
      cleanupComplete = true;
      console.error("ACP 2.6 best-effort cleanup completed after a failed assertion.");
    } catch (cleanupError) {
      console.error("ACP 2.6 best-effort cleanup failed:", cleanupError);
    }
  }
}

if (primaryError) throw primaryError;
assert.equal(cleanupComplete, true, "ACP 2.6 E2E exited without confirmed cleanup");
