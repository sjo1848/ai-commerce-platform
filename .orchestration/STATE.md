# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6-LLM-MODEL-ROUTER`
Status: `HUMAN_GATE`
Current sub-stage: `2.6.9 — HUMAN PRODUCT ACCEPTANCE`

## Last closed gate
`2.6.9 — HUMAN PRODUCT ACCEPTANCE REWORK` — `TECHNICAL_PASS / CLOSED`.
Closure evidence: `.orchestration/evidence/ACP-2.6.9-REWORK-CLOSURE.md`.

Final REWORK evidence is anchored to:
- substantive Artifact A `9ec9f062dfdc8ad9a73bb2646338d932b77c4c19`;
- exact-artifact core-ci `33322906416` — PASS;
- Foundation regression `84/84 PASS`;
- QA / Pre-Critic Gate — PASS;
- Independent Critic on PR #38 — PASS, zero blocking P0/P1/P2;
- integration head `38ed24aa272e9e75e1ee0a62c0dab37019a5b408`;
- post-merge core-ci `33322945318` — PASS;
- staging head `aa8f2ae1562cb67094714efb5cfeb29777c843ec`;
- staging deploy `33322986328` — PASS;
- E1 natural availability + ordinal quote — PASS;
- expanded real Workers AI conversational evaluator — PASS;
- date-only → guest clarification regression — PASS;
- prior-date reservation continuation regression — PASS;
- E2 controlled reservation/cancel — PASS, including HITL, idempotency, ownership and inventory restoration;
- staging handoff — PASS.

## Why the REWORK existed
The initial Human Product Acceptance correctly returned `REWORK` after free-form testing showed that the agent could lose dates/guest count across turns and repeat questions already answered. Subsequent real-model staging found two adjacent gaps: ordinal room references and incomplete model tool plans reaching HTTP 400 rather than conversational clarification.

The REWORK now uses durable structured conversation state for stay dates, guest count, authoritative HMS room candidates, current selection and active booking. The LLM interprets language; Core owns state and execution authority.

## Current gate — 2.6.9
A fresh Human Product Acceptance is mandatory before Phase 2.6 can be marked `PRODUCT_ACCEPTED` and before Fase 3 — Alquileres is unblocked.

Required human verdicts:
- `ACCEPT` — closes 2.6 as Product Accepted and enables the next roadmap phase under the same Agent Core + LLM Model Router architecture.
- `REWORK` — reopens only the concrete product findings reported by the human reviewer, then repeats the bounded method cycle and returns to this gate.

The Controller must not self-approve this gate.

## Product capability now proven technically
The HMS staging experience uses Workers AI as a real natural-language planning layer while authoritative operations remain outside the model. It can technically:
- retain stay dates and guest count across turns in durable server-side state;
- interpret natural Argentine Spanish for availability and follow-up questions;
- ground ordinal references such as “la primera” to the ordered HMS result without model-authored room IDs;
- reuse known dates/guest facts instead of asking them again;
- clarify only truly missing business fields rather than exposing technical HTTP 400 validation errors;
- ground prices and operational facts in HMS transactional results;
- reject trusted tenant/hotel/guest authority from user/model input;
- require HITL before reservation/cancellation writes;
- preserve idempotency, ownership, audit and inventory consistency.

## Non-negotiable architecture
The LLM may interpret, plan, clarify and compose. It may not choose trusted tenant/hotel/actor context, permissions, approval metadata, operation tokens or arbitrary tools. Tool Registry, structured conversation state, validation, Policy Engine, HITL, idempotency, audit, ownership and HMS transactional truth remain deterministic and authoritative.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until the explicit Human Product Acceptance verdict for 2.6 is `ACCEPT`.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, broader autonomous writes or second-vertical implementation is authorized while this Human Gate is open.
