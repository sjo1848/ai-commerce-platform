# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6.9-R2-NATURAL-RECEPTIONIST`
Status: `IN PROGRESS — R2.6 TECHNICAL_PASS / CLOSED`
Current sub-stage: `2.6.9-R2.7 — ADVERSARIAL QA + INDEPENDENT CRITIC — ACTIVE`
Last closed sub-stage: `2.6.9-R2.6 — MODEL QUALITY / LATENCY / COST EVALUATION — TECHNICAL_PASS / CLOSED`

## Why R2 remains open
Human Product Acceptance remains `REWORK` until the final natural-receptionist staging gate. R2.1 through R2.6 are technically closed. R2.7 now attacks the accumulated agentic behavior and deterministic safety boundary before the real-model staging E2E and human product gate.

Canonical R2 contract:
`.orchestration/contracts/ACP-2.6.9-R2-NATURAL-RECEPTIONIST.md`

R2.6 closure evidence:
`.orchestration/evidence/ACP-2.6.9-R2.6-MODEL-EVALUATION.md`

## R2 execution sequence
1. `2.6.9-R2.1` — Receptionist Product Contract + Acceptance Corpus — **TECHNICAL_PASS / CLOSED**
2. `2.6.9-R2.2` — Natural Receptionist Dialogue Layer — **TECHNICAL_PASS / CLOSED**
3. `2.6.9-R2.3` — Durable Semantic Memory v2 — **TECHNICAL_PASS / CLOSED**
4. `2.6.9-R2.4` — Multi-Room Conversation Model — **TECHNICAL_PASS / CLOSED**
5. `2.6.9-R2.5` — Multi-Room Reservation Orchestration — **TECHNICAL_PASS / CLOSED**
6. `2.6.9-R2.6` — Model Quality / Latency / Cost Evaluation — **TECHNICAL_PASS / CLOSED**
7. `2.6.9-R2.7` — Adversarial QA + Independent Critic — **ACTIVE**
8. `2.6.9-R2.8` — Real-Model Receptionist Staging E2E
9. `2.6.9-R2.9` — Human Product Acceptance — Natural Receptionist

## R2.6 final closure
Final substantive head:
`4fd636b599cd2a3389ca94e289146cdcc74485ab`

Verification:
- exact-head core-ci `33464908885` — **211/211 PASS** plus typecheck, staging E2 syntax and Wrangler dry-run;
- final real-model comparison `33464946093` — **PASS**;
- baseline model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — **13/13 PASS**, fallback `4.17%`, E2E p95 `6.589 s`, provider p95 `4.123 s`;
- candidate `@cf/openai/gpt-oss-20b` — **INELIGIBLE**, `0` valid inferences and `100% provider_failure`;
- model decision — **RETAIN_BASELINE**;
- baseline restored after comparison, Worker version `ca1cb430-aa17-4c4a-b25c-f11b2058b032`;
- QA — **PASS / RECLOSED** after three P1 false-green/safety fixes;
- Pre-Critic review `5073654629` — **PASS**;
- Independent Critic review `5073655778` — **PASS**;
- open P0/P1/P2 = `0/0/0`.

Closed R2.6 invariants:
- model replacement requires exact observed-model telemetry identity and hard-gate eligibility;
- quality evaluation cannot false-pass on loose substring matching;
- conversational model prose cannot introduce payment/process steps outside server-authorized safe meaning;
- model pricing is model-specific and unknown models cannot borrow stale baseline pricing;
- R2.6 model evaluation is read-only with respect to business mutations;
- trusted identity, policy/HITL, approval, idempotency, operation tokens, ownership and HMS transactional truth remain server-authoritative.

## R2.7 active scope
`2.6.9-R2.7 — Adversarial QA + Independent Critic` is now the only active R2 substage.

Mandatory attacks include the full R2 safety surface plus two explicit cross-stage regressions discovered during R2.6:
- provider failure after grounded multi-room selection must preserve R2.5 orchestration semantics rather than regress to the stale R2.4 unsupported path;
- semantically explicit guest phrasing such as `para dos` must not trigger a redundant guest-count clarification.

R2.7 must also re-attack prompt/tool injection, trusted tenant/hotel/actor spoofing, booking/room/guest injection, model-override injection, forged approval/idempotency/operation metadata, stale approvals, stale inventory, occupancy ambiguity, cancellation scope, cross-tenant/session ownership, OUTCOME_UNKNOWN/compensation uncertainty, memory poisoning and concurrent/stale replay.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until `2.6.9-R2.9` receives explicit human `ACCEPT`.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, broader autonomous writes or second-vertical implementation is authorized during R2.
