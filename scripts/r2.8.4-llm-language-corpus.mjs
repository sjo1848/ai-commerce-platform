#!/usr/bin/env node
import corpus from "../test/fixtures/r2.8.4-llm-language-corpus.json" with { type: "json" };

const baseUrl = process.env.AI_COMMERCE_STAGING_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("AI_COMMERCE_STAGING_URL is required");
const transcript = [];
// Deliberately never call the mutation endpoint: /api/approve is forbidden in this runner.
const mutationFields = /createdBookingIds|cancelledBookingIds|bookingId|reservationId|reservationGroup/i;
function roomIdsFor(numbers, rooms) { return numbers.map((number) => rooms.find((room) => String(room.roomNumber) === number)?.id).filter(Boolean); }
function bodyText(item) { return JSON.stringify(item.body ?? {}); }
function approvalTarget(item) { return item.body?.approval?.plan?.input?.roomIds ?? item.body?.approval?.input?.roomIds ?? item.body?.approvalTarget?.roomIds ?? []; }
function uuidTargets(summary) { return String(summary ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []; }
async function chat(message, sessionId, key) { return fetch(`${baseUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }), signal: AbortSignal.timeout(30_000) }); }
function approvalRequired(response, body) { return response.status === 409 && body?.error?.code === "APPROVAL_REQUIRED" && typeof body.approvalToken === "string"; }
for (const item of corpus.cases) {
  const availability = await chat("Somos dos. Del 1 al 3 de enero de 2030, ¿qué habitaciones están disponibles?", undefined, `r28-corpus-${item.id}-availability`);
  const availabilityBody = await availability.json();
  const sessionId = availabilityBody.sessionId;
  const rooms = Array.isArray(availabilityBody.data?.rooms) ? availabilityBody.data.rooms : [];
  const setupValid = availability.status >= 200 && availability.status < 300 && typeof sessionId === "string" && sessionId.length > 0 && availabilityBody.data?.source === "hms" && availabilityBody.data?.truth === "transactional" && ["101", "102", "103"].every((number) => rooms.some((room) => String(room.roomNumber) === number));
  const response = await chat(item.message, sessionId, `r28-corpus-${item.id}-intent`);
  const raw = await response.text();
  let body; try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
  const expectedIds = item.expected.roomNumbers ? roomIdsFor(item.expected.roomNumbers, rooms) : [];
  let finalResponse = response; let finalBody = body;
  if (item.expected.roomNumbers && !approvalRequired(response, body) && response.status >= 200 && response.status < 300) {
    finalResponse = await chat("Reservá la selección actual.", sessionId, `r28-corpus-${item.id}-probe`); const probeRaw = await finalResponse.text(); try { finalBody = probeRaw ? JSON.parse(probeRaw) : {}; } catch { finalBody = { raw: probeRaw }; }
  }
  const target = approvalTarget({ body: finalBody });
  const summaryIds = uuidTargets(finalBody.approvalSummary);
  const observedTargets = target.length ? target : summaryIds;
  const targetMatches = item.expected.roomNumbers ? expectedIds.length === item.expected.roomNumbers.length && observedTargets.length === expectedIds.length && observedTargets.every((id) => expectedIds.includes(id)) : observedTargets.length === 0;
  const approval = approvalRequired(finalResponse, finalBody);
  const mutationSignals = [availabilityBody, body, finalBody].filter((value, index, all) => index === all.indexOf(value)).filter((value) => mutationFields.test(JSON.stringify(value)));
  const mutation = mutationSignals.length > 0;
  const pass = setupValid && (item.expected.clarification ? response.status >= 200 && response.status < 300 && !approval && !mutation : !mutation && targetMatches && approval);
  transcript.push({ id: item.id, category: item.category, expected: item.expected, setupValid, initial: { status: response.status, body }, final: { status: finalResponse.status, body: finalBody }, authoritativeRooms: rooms.map(({ id, roomNumber }) => ({ id, roomNumber })), approvalConsumed: false, mutation, mutationSignals, pass });
}
const failed = transcript.filter((item) => !item.pass);
const report = { event: failed.length === 0 ? "ACP_R2_8_4_LLM_CORPUS_COMPLETE" : "ACP_R2_8_4_LLM_CORPUS_FAIL", version: corpus.version, cases: transcript.length, hmsMutationRequests: transcript.filter((item) => item.mutation).length, approvalConsumed: false, externallyUnassertable: ["server audit correlation of every downstream mutation requires observability attachment"], results: transcript.map(({ id, pass, mutation, approvalConsumed }) => ({ id, pass, mutation, approvalConsumed })), transcript };
console.log(JSON.stringify(report, null, 2));
if (failed.length > 0) process.exit(1);
