# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6-LLM-MODEL-ROUTER`
Status: `HUMAN_GATE`
Current sub-stage: `2.6.9 — HUMAN PRODUCT ACCEPTANCE`

## Last closed gate
`2.6.8 — CONVERSATIONAL STAGING E2E` — `TECHNICAL_PASS / CLOSED`.
Closure evidence: `.orchestration/evidence/ACP-2.6.8-REAL-MODEL-STAGING.md`.

Final 2.6.8 evidence is anchored to:
- runtime Artifact A `3468026011170f7bb9106d1a2b7e6d1ecf2d7cdd`;
- PR #32 exact-artifact core-ci `33319324060` — PASS;
- Pre-Critic Gate — PASS;
- Independent Critic — PASS;
- integration head `97522064a63d7dfb3d9691414b52c1fe5da5d12b`;
- post-merge core-ci `33319393065` — PASS;
- staging head `6ea974c725b6ca288da8501ef28f5a2f11d2a5fa`;
- staging deploy `33319422840` — PASS;
- Foundation regression: `75/75 PASS`;
- E1 natural same-session availability + quote — PASS;
- ACP 2.6.8 real-model evaluator — `5/5 PASS`, `naturalCorrectness=1`, `safety=true`, `7` real model inferences, `0` fallbacks;
- E2 controlled reservation/cancel — PASS, including HITL, server-bound guest identity, authoritative replay/conflict, ownership and inventory restoration.

## Current gate — 2.6.9
Human Product Acceptance is mandatory before Phase 2.6 can be marked `PRODUCT_ACCEPTED` and before Fase 3 — Alquileres is unblocked.

Required human verdicts:
- `ACCEPT` — closes 2.6 as Product Accepted and enables the next roadmap phase under the same Agent Core + LLM Model Router architecture.
- `REWORK` — reopens only the concrete product findings reported by the human reviewer, then repeats the bounded method cycle and returns to this gate.

The Controller must not self-approve this gate.

## Product capability now proven technically
The HMS staging experience uses Workers AI as a real natural-language planning layer while authoritative operations remain outside the model. It can:
- interpret natural Argentine Spanish for availability;
- use safe same-session operational context for references such as “la primera”;
- clarify missing information instead of inventing it;
- ground prices and operational facts in HMS transactional results;
- reject trusted tenant/hotel/guest authority from user/model input;
- require HITL before reservation/cancellation writes;
- preserve idempotency, ownership, audit and inventory consistency.

## Non-negotiable architecture
The LLM may interpret, plan, clarify and compose. It may not choose trusted tenant/hotel/actor context, permissions, approval metadata, operation tokens or arbitrary tools. Tool Registry, validation, Policy Engine, HITL, idempotency, audit, ownership and HMS transactional truth remain deterministic and authoritative.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until the explicit Human Product Acceptance verdict for 2.6 is `ACCEPT`.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, broader autonomous writes or second-vertical implementation is authorized while this Human Gate is open.
