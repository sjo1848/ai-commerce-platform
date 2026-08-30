# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6.9-REWORK-RECEPTIONIST`
Status: `REWORK / IMPLEMENTATION`
Current sub-stage: `2.6.9-R2 — RECEPTIONIST CONVERSATION`

## Human verdict
Fresh Human Product Acceptance on 2026-08-30 returned `REWORK`.

Observed product failures:
- conversation still feels rigid rather than like a human receptionist;
- greeting/pleasantry behavior is brusque/command-like;
- previously supplied guest-count facts are not reliably reused in free-form conversation;
- multi-room intent such as “reservame la 102 y la 101” is not supported by the current single-room state/tool contract.

## Root cause
The raw model is not the primary bottleneck. Staging uses Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, but current Core architecture restricts it to structured planning and fixed response templates. `ConversationState` and `hms.createReservation` are also single-room oriented.

Contract: `.orchestration/contracts/ACP-2.6.9-REWORK-RECEPTIONIST.md`.

## Authorized REWORK scope
1. Hospitality/social conversation mode for greetings, thanks and normal transitions.
2. Natural grounded response composition with deterministic verified-fact guardrails.
3. Durable party composition / guest allocation state.
4. Authoritative room-number grounding and multi-room selection.
5. Composite multi-room reservation with exact HITL fingerprint, deterministic child idempotency, ownership and compensation on partial failure.
6. Expanded QA/adversarial corpus.
7. Independent Critic.
8. Real-model staging E2E.
9. Return to Human Product Acceptance.

## Non-negotiable architecture
The LLM may interpret, plan, converse and naturalize verified results. It may not choose trusted tenant/hotel/actor/guest identity, permissions, approval metadata, operation tokens, idempotency keys or arbitrary tools. Tool Registry, structured state, validation, Policy Engine, HITL, idempotency, audit, ownership and HMS transactional truth remain deterministic and authoritative.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until explicit Human Product Acceptance `ACCEPT` after this REWORK.

## Boundaries
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement or second-vertical implementation is authorized.