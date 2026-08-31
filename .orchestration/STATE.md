# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6.9-R2-NATURAL-RECEPTIONIST`
Status: `REWORK / IN PROGRESS`
Current sub-stage: `2.6.9-R2.1 — RECEPTIONIST PRODUCT CONTRACT + ACCEPTANCE CORPUS`

## Why R2 is open
The second Human Product Acceptance returned `REWORK` after free-form staging testing showed four product gaps:
- greeting/social behavior still feels abrupt rather than like a hotel receptionist;
- user-facing operational prose remains largely template-deterministic even though routing uses a real LLM;
- previously supplied guest count is not reliable enough in unconstrained conversation;
- the state/execution model cannot represent a multi-room request such as rooms 101 + 102.

The current Workers AI model is real Llama 3.3 70B. R2 therefore treats this as a product/architecture gap first and postpones model replacement decisions until the architecture stops constraining natural response composition.

Canonical R2 contract:
`.orchestration/contracts/ACP-2.6.9-R2-NATURAL-RECEPTIONIST.md`

## R2 execution sequence
Only one substage is active at a time:
1. `2.6.9-R2.1` — Receptionist Product Contract + Acceptance Corpus — **ACTIVE**
2. `2.6.9-R2.2` — Natural Receptionist Dialogue Layer
3. `2.6.9-R2.3` — Durable Semantic Memory v2
4. `2.6.9-R2.4` — Multi-Room Conversation Model
5. `2.6.9-R2.5` — Multi-Room Reservation Orchestration
6. `2.6.9-R2.6` — Model Quality / Latency / Cost Evaluation
7. `2.6.9-R2.7` — Adversarial QA + Independent Critic
8. `2.6.9-R2.8` — Real-Model Receptionist Staging E2E
9. `2.6.9-R2.9` — Human Product Acceptance — Natural Receptionist

## Current objective — R2.1
Freeze the product contract before changing runtime. Define observable acceptance behavior for:
- greeting and social acknowledgement;
- cordial, concise receptionist tone;
- natural Argentine Spanish and colloquial phrasing;
- continuation without re-asking known facts;
- correction/change-of-mind semantics;
- references such as “la primera”, room numbers and “las dos”;
- multi-room requests and occupancy ambiguity;
- unsupported questions and graceful boundaries;
- grounded operational facts only.

R2.1 closes only when the corpus and thresholds are frozen and technically reviewed. R2.1 has no Human Gate.

## Non-negotiable architecture
The LLM may interpret language, maintain conversational intent through bounded structured state patches and compose natural prose from server-grounded facts. It may not author operational truth or trusted authority.

Tool Registry, tenant/hotel/actor bindings, canonical validation, HMS facts, Policy/HITL, exact approval plan, idempotency, ownership, audit and multi-room execution semantics remain deterministic/server-authoritative.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until `2.6.9-R2.9` receives explicit human `ACCEPT`.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, broader autonomous writes or second-vertical implementation is authorized during R2.
