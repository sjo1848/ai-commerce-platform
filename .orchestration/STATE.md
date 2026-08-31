# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6.9-R2-NATURAL-RECEPTIONIST`
Status: `IN PROGRESS — R2.4 BUILD / QA`
Current sub-stage: `2.6.9-R2.4 — MULTI-ROOM CONVERSATION MODEL — ACTIVE`
Last closed sub-stage: `2.6.9-R2.3 — DURABLE SEMANTIC MEMORY V2 — TECHNICAL_PASS / CLOSED`

## Why R2 remains open
Human Product Acceptance is still `REWORK` after free-form staging testing found four product gaps: receptionist naturalness, visible response quality, reliable guest-count memory, and multi-room conversation/execution.

R2.1, R2.2 and R2.3 are technically closed. R2.4 is now active and addresses the multi-room conversation/state gap only. Multi-room side-effect execution remains R2.5.

Canonical R2 contract:
`.orchestration/contracts/ACP-2.6.9-R2-NATURAL-RECEPTIONIST.md`

R2.4 contract:
`.orchestration/contracts/ACP-2.6.9-R2.4-MULTI-ROOM-CONVERSATION.md`

## R2 execution sequence
1. `2.6.9-R2.1` — Receptionist Product Contract + Acceptance Corpus — **TECHNICAL_PASS / CLOSED**
2. `2.6.9-R2.2` — Natural Receptionist Dialogue Layer — **TECHNICAL_PASS / CLOSED**
3. `2.6.9-R2.3` — Durable Semantic Memory v2 — **TECHNICAL_PASS / CLOSED**
4. `2.6.9-R2.4` — Multi-Room Conversation Model — **IN PROGRESS / BUILD + QA**
5. `2.6.9-R2.5` — Multi-Room Reservation Orchestration — **BLOCKED BY R2.4**
6. `2.6.9-R2.6` — Model Quality / Latency / Cost Evaluation
7. `2.6.9-R2.7` — Adversarial QA + Independent Critic
8. `2.6.9-R2.8` — Real-Model Receptionist Staging E2E
9. `2.6.9-R2.9` — Human Product Acceptance — Natural Receptionist

## R2.4 implementation candidate
Candidate implementation head before QA-boundary commit:
`262d8814c29fd677fdbf643e4b9845654a32e6a1`

Implementation runner:
- workflow run `33411873709` — **PASS**;
- tests `158/158` — **PASS**;
- TypeScript typecheck — **PASS**;
- staging E2 syntax — **PASS**;
- Wrangler Worker dry-run — **PASS**.

Implemented conversation/state capabilities:
- authoritative HMS candidate mapping with room `id + roomNumber`;
- canonical ordered `selectedRoomIds[]` with single-room compatibility alias;
- bounded room references by exact candidate ID, room number and one-based ordinal;
- `requestedRoomCount` without arbitrary room choice;
- explicit per-room occupancy grounded to selected candidates;
- room-selection revisioning against stale/concurrent rollback;
- server-side blocking of multi-room `hms.createReservation` in R2.4;
- single-room quote/reservation behavior preserved.

## Active QA focus
The initial implementation is not frozen yet. Fresh QA/Critic must explicitly challenge:
- natural relational references (`las dos`, `la otra`) rather than only explicit numbers/ordinals;
- invalid/unknown occupancy references and whether they can be silently dropped;
- stale availability refresh versus remembered room selection;
- room-selection revision conflict behavior independent of semantic revisions;
- multi-room quote behavior and whether the conversation remains coherent without unsafe execution;
- preservation of single-room Policy/HITL/idempotency/ownership invariants.

Any P0/P1/P2 finding returns R2.4 to automatic REWORK. No substantive Artifact A is frozen until these checks pass.

## Gate to R2.5
R2.5 remains blocked until R2.4 has:
- exact-head CI PASS;
- frozen R2.4 regressions for the accepted conversation model;
- QA PASS;
- Pre-Critic PASS;
- fresh Independent Critic PASS;
- open P0/P1/P2 = `0/0/0`;
- merge + post-merge main regression PASS;
- GitHub/Drive/state convergence.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until `2.6.9-R2.9` receives explicit human `ACCEPT`.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, multi-room side-effect execution, broader autonomous writes or second-vertical implementation is authorized during R2.4.
