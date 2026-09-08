#!/usr/bin/env node
import corpus from "../test/fixtures/r2.8.4-llm-language-corpus.json" with { type: "json" };
import { proveValidationTurn } from "./r2.8-validation-turn-proof.mjs";
import { validationRequestHeaders } from "./validation-request-headers.mjs";

const baseUrl = process.env.AI_COMMERCE_STAGING_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("AI_COMMERCE_STAGING_URL is required");
const transcript = [];
const mutationFields = /"(?:createdBookingIds|cancelledBookingIds|bookingId|reservationId|reservationGroup)"\s*:/i;
const mutationSignals = [];
const sameSet = (a, b) => Array.isArray(b) && new Set(a).size === a.length && new Set(b).size === b.length && a.length === b.length && a.every(x => b.includes(x));
const approval = item => item.status === 409 && item.body?.error?.code === "APPROVAL_REQUIRED" && typeof item.body.approvalToken === "string" && item.body.approvalToken.length > 0;
const clarification = (item, field) => {
  const body = item.body;
  const uniqueMissing = [...new Set(body?.missing ?? [])];
  return item.status >= 200 && item.status < 300 && body.outcome === "clarification" && JSON.stringify(uniqueMissing) === JSON.stringify([field]) && JSON.stringify(body.missing) === JSON.stringify([field]) && typeof body?.message === "string" && body.message.trim().length > 0 && !/approvalToken|approvalSummary|approvalTarget|approvalPlan|APPROVAL_REQUIRED/.test(JSON.stringify(body));
};
let current;
function requirePass(pass, reason) { if (!pass) throw Error(reason); }
async function chat(message, sessionId) {
  const requestId = `r28-corpus-${current.id}-${crypto.randomUUID()}`;
  const response = await fetch(`${baseUrl}/api/chat`, { method: "POST", headers: validationRequestHeaders({ "content-type": "application/json", "x-request-id": requestId, "Idempotency-Key": crypto.randomUUID() }), body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }), signal: AbortSignal.timeout(30_000) });
  const raw = await response.text(); let body;
  try { body = JSON.parse(raw); } catch { body = { raw }; }
  const item = { requestId, status: response.status, body, user: message };
  current.turns.push(item);
  item.routeProof = await proveValidationTurn(requestId, body.sessionId);
  if (mutationFields.test(JSON.stringify(body))) mutationSignals.push({ caseId: current.id, requestId });
  requirePass(mutationSignals.length === 0, "response mutation signal");
  requirePass(!sessionId || body.sessionId === sessionId, "session identity changed");
  return item;
}
function exactApproval(item, numbers, rooms, guests) {
  const ids = numbers.map(number => rooms.find(room => String(room.roomNumber) === number)?.id);
  const plan = item.body?.approvalPlan, context = item.body?.approvalContext;
  const targets = numbers.length === 1 ? [plan?.input?.roomId] : plan?.input?.roomIds;
  return ids.every(Boolean) && approval(item) && plan?.toolId === (numbers.length === 1 ? "hms.createReservation" : "hms.createMultiReservation") && sameSet(ids, targets)
    && plan.input.checkIn === "2030-01-01" && plan.input.checkOut === "2030-01-03"
    && context?.stay?.checkIn === "2030-01-01" && context?.stay?.checkOut === "2030-01-03" && context?.stay?.guests === guests && sameSet(ids, context?.selectedRoomIds);
}
try {
  for (const item of corpus.cases) {
    current = { id: item.id, category: item.category, expected: item.expected, turns: [], pass: false, approvalConsumed: false };
    transcript.push(current);
    const guests = item.setupGuests ?? 2;
    const setup = await chat(`Somos ${guests}. Del 1 al 3 de enero de 2030, ¿qué habitaciones están disponibles?`);
    const sessionId = setup.body.sessionId, data = setup.body.data;
    const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
    current.setup = setup;
    current.setupValid = setup.status >= 200 && setup.status < 300 && typeof sessionId === "string" && sessionId.length > 0 && data?.source === "hms" && data?.truth === "transactional" && data.start === "2030-01-01" && data.end === "2030-01-03" && data.requestedGuests === guests && ["101", "102", "103"].every(number => rooms.filter(room => String(room.roomNumber) === number).length === 1);
    requirePass(current.setupValid, "invalid authoritative setup");
    current.authoritativeRooms = rooms.map(({id, roomNumber}) => ({id, roomNumber}));
    if (item.priorSelection) {
      const prior = await chat(`Quiero reservar la ${item.priorSelection}.`, sessionId);
      requirePass(exactApproval(prior, [item.priorSelection], rooms, guests), "prior selection did not reach exact unconsumed HITL");
    }
    const initial = await chat(item.message, sessionId); current.initial = initial;
    let final = initial;
    if (item.expected.clarification) {
      requirePass(clarification(initial, item.expected.clarification), "missing explicit selection clarification");
      if (item.priorSelection) {
        final = await chat("Reservá la selección actual.", sessionId);
        requirePass(clarification(final, item.expected.clarification), "invalid reference left stale selection authorizable");
      }
    } else {
      // A non-write selection may need one explicit reservation instruction; an
      // invalid/clarifying selection must never be rescued by another request.
      if (!approval(initial)) {
        requirePass(initial.status >= 200 && initial.status < 300 && initial.body.outcome !== "clarification", "selection failed before reservation instruction");
        final = await chat("Reservá la selección actual.", sessionId);
      }
      requirePass(exactApproval(final, item.expected.roomNumbers, rooms, guests), "final plan differs from latest authoritative selection/stay");
    }
    current.final = final;
    current.observedOutcome = initial.body?.outcome;
    current.observedMissing = initial.body?.missing;
    current.approvalTarget = final.body?.approvalPlan?.input?.roomIds ?? final.body?.approvalPlan?.input?.roomId ?? [];
    current.approvalSummary = final.body?.approvalSummary ?? null;
    current.mutationSignals = [...mutationSignals];
    current.pass = true;
  }
} catch (error) { if (current) current.failure = error.message; }
const passed = transcript.length === corpus.cases.length && transcript.every(item => item.pass);
console.log(JSON.stringify({ event: passed ? "ACP_R2_8_4_LLM_CORPUS_COMPLETE" : "ACP_R2_8_4_LLM_CORPUS_FAIL", version: corpus.version, cases: transcript.length, expectedCases: corpus.cases.length, approvalConsumed: false, hmsMutations: "UNKNOWN_PENDING_AUDIT", mutationSignals, results: transcript.map(({id, pass, failure}) => ({id, pass, failure})), transcript }, null, 2));
if (!passed) process.exitCode = 1;
