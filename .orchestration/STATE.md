# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6.9-R2-NATURAL-RECEPTIONIST`
Status: `REWORK / IN PROGRESS`
Current sub-stage: `2.6.9-R2.2 — NATURAL RECEPTIONIST DIALOGUE LAYER`

## Why R2 is open
The second Human Product Acceptance returned `REWORK` after free-form staging testing showed four product gaps:
- greeting/social behavior still feels abrupt rather than like a hotel receptionist;
- user-facing operational prose remains largely template-deterministic even though routing uses a real LLM;
- previously supplied guest count is not reliable enough in unconstrained conversation;
- the state/execution model cannot represent a multi-room request such as rooms 101 + 102.

The current Workers AI model is real Llama 3.3 70B. R2 treats this as a product/architecture gap first and postpones model replacement decisions until R2.6, after the architecture stops constraining natural response composition.

Canonical R2 contract:
`.orchestration/contracts/ACP-2.6.9-R2-NATURAL-RECEPTIONIST.md`

## R2 execution sequence
Only one substage is active at a time:
1. `2.6.9-R2.1` — Receptionist Product Contract + Acceptance Corpus — **TECHNICAL_PASS / CLOSED**
2. `2.6.9-R2.2` — Natural Receptionist Dialogue Layer — **ACTIVE**
3. `2.6.9-R2.3` — Durable Semantic Memory v2
4. `2.6.9-R2.4` — Multi-Room Conversation Model
5. `2.6.9-R2.5` — Multi-Room Reservation Orchestration
6. `2.6.9-R2.6` — Model Quality / Latency / Cost Evaluation
7. `2.6.9-R2.7` — Adversarial QA + Independent Critic
8. `2.6.9-R2.8` — Real-Model Receptionist Staging E2E
9. `2.6.9-R2.9` — Human Product Acceptance — Natural Receptionist

R2.1 evidence:
`.orchestration/evidence/ACP-2.6.9-R2.1-RECEPTIONIST-CORPUS.md`
Exact corpus head `421a2e0d618fedb42a60ac370f2c91fffdd3133e`; CI `33346138654` PASS.

## Current objective — R2.2
Replace the template-dominated conversational surface while preserving factual authority.

R2.2 scope:
- explicit non-operational conversational intents: greeting, social acknowledgement and help;
- a server-built `GroundedFactEnvelope` for operational response composition;
- model-written natural receptionist prose constrained to facts in that envelope;
- deterministic cordial safe fallback on provider failure;
- tests proving the generated response cannot add operational facts outside the envelope.

R2.2 explicitly does **not** implement Semantic Memory v2 or multi-room state/execution; those remain R2.3–R2.5.

## Non-negotiable architecture
The LLM may interpret language, maintain conversational intent through bounded structured state patches and compose natural prose from server-grounded facts. It may not author operational truth or trusted authority.

Tool Registry, tenant/hotel/actor bindings, canonical validation, HMS facts, Policy/HITL, exact approval plan, idempotency, ownership, audit and multi-room execution semantics remain deterministic/server-authoritative.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until `2.6.9-R2.9` receives explicit human `ACCEPT`.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, broader autonomous writes or second-vertical implementation is authorized during R2.
