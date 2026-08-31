# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6.9-R2-NATURAL-RECEPTIONIST`
Status: `REWORK / IN PROGRESS`
Current sub-stage: `2.6.9-R2.3 — DURABLE SEMANTIC MEMORY V2`

## Why R2 is open
The second Human Product Acceptance returned `REWORK` after free-form staging testing showed four product gaps:
- greeting/social behavior still felt abrupt rather than like a hotel receptionist;
- user-facing operational prose remained largely template-deterministic even though routing used a real LLM;
- previously supplied guest count was not reliable enough in unconstrained conversation;
- the state/execution model could not represent a multi-room request such as rooms 101 + 102.

R2.1 froze the acceptance contract. R2.2 has now closed the visible natural-dialogue gap while preserving server-authoritative operational facts. The remaining active gap is durable semantic memory; multi-room remains later in R2.4/R2.5.

Canonical R2 contract:
`.orchestration/contracts/ACP-2.6.9-R2-NATURAL-RECEPTIONIST.md`

## R2 execution sequence
Only one substage is active at a time:
1. `2.6.9-R2.1` — Receptionist Product Contract + Acceptance Corpus — **TECHNICAL_PASS / CLOSED**
2. `2.6.9-R2.2` — Natural Receptionist Dialogue Layer — **TECHNICAL_PASS / CLOSED**
3. `2.6.9-R2.3` — Durable Semantic Memory v2 — **ACTIVE**
4. `2.6.9-R2.4` — Multi-Room Conversation Model
5. `2.6.9-R2.5` — Multi-Room Reservation Orchestration
6. `2.6.9-R2.6` — Model Quality / Latency / Cost Evaluation
7. `2.6.9-R2.7` — Adversarial QA + Independent Critic
8. `2.6.9-R2.8` — Real-Model Receptionist Staging E2E
9. `2.6.9-R2.9` — Human Product Acceptance — Natural Receptionist

## Last closed gate — R2.2
Closure evidence:
`.orchestration/evidence/ACP-2.6.9-R2.2-NATURAL-DIALOGUE.md`

Exact references:
- substantive Artifact A `6fa16baa52f0d8417f2d86f2204832db8715ae58`;
- exact-artifact core-ci `33348863405` — PASS;
- `97/97` tests PASS;
- QA — PASS;
- first critic cycle found one P2 in total-vs-shown availability semantics; automatic REWORK fixed it with regressions;
- fresh Independent Critic — PASS, P0/P1/P2 = `0/0/0`;
- PR #43 integration `5d65d9ff962cd0000fbf5ded1f0facc37efb9fe4`;
- post-merge main core-ci `33348976381` — PASS.

R2.2 delivers natural greeting/social/clarification and model-written operational prose through a server-built `GroundedFactEnvelope`. Model prose is validated before Core hydrates authoritative placeholders; ungrounded/invalid drafts fail closed to deterministic rendering.

## Current objective — R2.3
Build Durable Semantic Memory v2 so conversation facts are reliable across natural turns without reconstructing authority from prose history.

R2.3 must define and implement server-owned semantic facts for the current guest journey, including at minimum:
- stay dates;
- guest count;
- explicit corrections/change-of-mind;
- bounded preferences/intent where useful;
- source/provenance and freshness semantics sufficient to prevent stale or poisoned facts;
- tenant/actor/session isolation;
- deterministic precedence when current user input corrects prior state.

R2.3 must prove that known dates/guest count are not unnecessarily asked again and that a correction such as “no, somos tres” replaces the previous value rather than creating competing facts.

R2.3 does **not** implement the multi-room state/execution model. Rooms 101 + 102 remain R2.4/R2.5.

## Non-negotiable architecture
The LLM may interpret language and propose bounded semantic state patches; Core owns validation, persistence, precedence and trusted state.

Operational truth and authority remain outside the model. Tool Registry, tenant/hotel/actor bindings, canonical validation, HMS facts, Policy/HITL, exact approval plan, idempotency, ownership and audit remain deterministic/server-authoritative.

## Gate to R2.4
R2.4 stays blocked until R2.3 has technical PASS with:
- known-fact retention corpus PASS;
- correction semantics PASS;
- tenant/actor/session isolation PASS;
- memory-poisoning regressions PASS;
- no open P0/P1/P2.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until `2.6.9-R2.9` receives explicit human `ACCEPT`.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, broader autonomous writes or second-vertical implementation is authorized during R2.
