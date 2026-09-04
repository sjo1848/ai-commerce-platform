#!/usr/bin/env node

const baseUrl = process.env.AI_COMMERCE_STAGING_URL?.replace(/\/$/, "");
const sessionId = process.env.R28_RECOVERY_SESSION_ID?.trim();
if (!baseUrl) throw new Error("AI_COMMERCE_STAGING_URL is required");
if (!sessionId) throw new Error("R28_RECOVERY_SESSION_ID is required");

let seq = 0;
const transcript = [];

async function call(path, { message, key, approvalToken, session = sessionId } = {}) {
  seq += 1;
  const requestId = `r28-r5-recover-${seq}-${crypto.randomUUID()}`;
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
  const item = { path, requestId, user: message, status: response.status, body, key: key ?? null };
  transcript.push(item);
  return item;
}

function approvalRequired(item) {
  return item?.status === 409 && item?.body?.error?.code === "APPROVAL_REQUIRED" && typeof item?.body?.approvalToken === "string" && Boolean(item.body.approvalToken);
}

let key = `r28-r5-recover-${crypto.randomUUID()}`;
let pending = await call("/api/chat", { message: "Cancelá todas las reservas de este grupo.", key });

if (!approvalRequired(pending) && pending.status === 200) {
  key = `r28-r5-recover-scope-${crypto.randomUUID()}`;
  pending = await call("/api/chat", { message: "Todas las reservas activas del grupo.", key });
}

if (!approvalRequired(pending)) {
  console.log(JSON.stringify({ event: "ACP_R2_8_5_RECOVERY_CLEANUP_FAIL", reason: "approval_boundary_not_reached", transcript }, null, 2));
  process.exit(1);
}

const approved = await call("/api/approve", {
  message: pending.user,
  key: pending.key,
  approvalToken: pending.body.approvalToken,
});
if (approved.status !== 200) {
  console.log(JSON.stringify({ event: "ACP_R2_8_5_RECOVERY_CLEANUP_FAIL", reason: "approval_failed", transcript }, null, 2));
  process.exit(1);
}

const verifyKey = `r28-r5-recover-verify-${crypto.randomUUID()}`;
const verify = await call("/api/chat", {
  message: "Somos cuatro y queremos quedarnos del 1 al 3 de enero de 2030. ¿Qué habitaciones hay disponibles?",
  key: verifyKey,
  session: undefined,
});
const rooms = Array.isArray(verify?.body?.data?.rooms)
  ? verify.body.data.rooms.map((room) => String(room?.roomNumber ?? "")).filter(Boolean)
  : [];
const restored = verify.status === 200 && rooms.includes("101") && rooms.includes("102");

console.log(JSON.stringify({
  event: restored ? "ACP_R2_8_5_RECOVERY_CLEANUP_PASS" : "ACP_R2_8_5_RECOVERY_CLEANUP_FAIL",
  sessionId,
  rooms,
  transcript,
}, null, 2));
if (!restored) process.exit(1);
