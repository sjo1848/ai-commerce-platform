# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6.9-R2-NATURAL-RECEPTIONIST`
Status: `IN PROGRESS — R2.7 TECHNICAL_PASS / CLOSED`
Current sub-stage: `2.6.9-R2.8 — REAL-MODEL RECEPTIONIST STAGING E2E — ACTIVE`
Last closed sub-stage: `2.6.9-R2.7 — ADVERSARIAL QA + INDEPENDENT CRITIC — TECHNICAL_PASS / CLOSED`

## Why R2 remains open
Human Product Acceptance remains `REWORK` until the final natural-receptionist human gate. R2.1 through R2.7 are technically closed. R2.8 must now prove the full receptionist experience against the real authorized model and HMS staging before R2.9 can be presented to the user.

Canonical R2 contract:
`.orchestration/contracts/ACP-2.6.9-R2-NATURAL-RECEPTIONIST.md`

R2.7 closure evidence:
`.orchestration/evidence/ACP-2.6.9-R2.7-ADVERSARIAL-QA-CLOSURE.md`

## R2 execution sequence
1. `2.6.9-R2.1` — Receptionist Product Contract + Acceptance Corpus — **TECHNICAL_PASS / CLOSED**
2. `2.6.9-R2.2` — Natural Receptionist Dialogue Layer — **TECHNICAL_PASS / CLOSED**
3. `2.6.9-R2.3` — Durable Semantic Memory v2 — **TECHNICAL_PASS / CLOSED**
4. `2.6.9-R2.4` — Multi-Room Conversation Model — **TECHNICAL_PASS / CLOSED**
5. `2.6.9-R2.5` — Multi-Room Reservation Orchestration — **TECHNICAL_PASS / CLOSED**
6. `2.6.9-R2.6` — Model Quality / Latency / Cost Evaluation — **TECHNICAL_PASS / CLOSED**
7. `2.6.9-R2.7` — Adversarial QA + Independent Critic — **TECHNICAL_PASS / CLOSED**
8. `2.6.9-R2.8` — Real-Model Receptionist Staging E2E — **ACTIVE**
9. `2.6.9-R2.9` — Human Product Acceptance — Natural Receptionist

## R2.7 final closure
Final substantive Artifact A:
`363c1937d17e71a09e513707185a127332a792ec`

Verification:
- initial cross-stage RED CI `33467426308` / #457 reproduced provider-failure multi-room regression and missing natural `para dos` grounding;
- intermediate rework CI `33467815488` / #460 — **215/215 PASS**;
- fresh QA RED CI `33467984755` / #461 exposed `dos noches` duration/guest ambiguity;
- final substantive CI `33468363790` / #463 — **216/216 PASS**, typecheck, staging-E2 syntax and Wrangler dry-run PASS;
- QA — **PASS / RECLOSED**; evidence head `e243d7fa216b430bdba9ccac400ee96c12b3e6c0`; CI `33468438376` / #464 PASS;
- Pre-Critic review `5073907311` — **PASS**;
- Independent Critic review `5073910176` — **PASS**;
- closure-evidence head `fc6fc013496205dd84ea1864e02eba35a7b84fdf`; CI `33468557478` / #465 PASS;
- non-draft integration PR #52 exact-head CI `33468630047` / #466 PASS;
- PR #52 merge `c42f1c8354dbba8ae13b442872349430739f3796`;
- post-merge `main` CI `33468664436` / #467 — **PASS**;
- open P0/P1/P2 = `0/0/0`.

Closed R2.7 invariants:
- provider failure preserves R2.5 multi-room semantics instead of reverting to stale R2.4 fallback behavior;
- deterministic fallback never collapses grounded multi-room intent into `hms.createReservation`;
- fallback may propose the visible composite capability, but Core still owns room/occupancy ambiguity checks and canonical room/date grounding;
- natural `habitaciones para dos/2` persists user-owned party-size memory;
- duration phrasing such as `dos noches` cannot fabricate guest count while availability intent is preserved;
- prompt/tool/trusted-field injection, tenant/session isolation, memory poisoning/stale replay, HITL exact-plan binding, ownership/idempotency, cancellation scope and uncertainty/compensation protections remain green;
- trusted tenant/hotel/actor/guest identity, approval metadata, operation tokens, booking ownership and HMS transactional truth remain server-authoritative.

## R2.8 active scope
`2.6.9-R2.8 — Real-Model Receptionist Staging E2E` is now the only active R2 substage.

It must exercise the authorized baseline model on real staging with natural language rather than parser-shaped commands, including:
- greeting/social continuity;
- `habitaciones para dos` without redundant guest clarification;
- dates and guests supplied across turns plus corrections;
- real availability and grounded room-number/ordinal references;
- natural multi-room selection including the original 101+102 class of request;
- room-level occupancy when needed;
- exact HITL confirmation before reservation;
- authoritative multi-room create, verification, cancellation and cleanup;
- real provider failure/fallback behavior where safely reproducible;
- audit/usage/latency evidence.

Mandatory R2.8 quality probe: `llm-model.ts` still contains historical R2.4 wording about multi-room side effects being blocked until R2.5. R2.8 must prove whether the real model still completes the multi-room flow naturally; R2.7 fallback evidence does not waive that requirement.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until `2.6.9-R2.9` receives explicit human `ACCEPT`.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, broader autonomous writes or second-vertical implementation is authorized during R2.
