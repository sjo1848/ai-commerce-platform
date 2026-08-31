# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6.9-R2-NATURAL-RECEPTIONIST`
Status: `REWORK / IN PROGRESS`
Current sub-stage: `2.6.9-R2.3 — DURABLE SEMANTIC MEMORY V2 — LATE CRITIC REWORK`
Last closed sub-stage: `2.6.9-R2.2 — NATURAL RECEPTIONIST DIALOGUE LAYER — TECHNICAL_PASS / CLOSED`

## Why R2 is open
The second Human Product Acceptance returned `REWORK` after free-form staging testing showed four product gaps: receptionist naturalness, visible response quality, reliable guest-count memory, and multi-room conversation/execution.

R2.1 and R2.2 are closed. R2.3 attempted technical closure on 2026-08-31, but a fresh Codex review completed after PR #44 had already merged and found six additional P1/P2 defects. By method, that closure is invalidated and R2.3 is reopened automatically. R2.4 is blocked again until this rework receives a fresh technical PASS.

Canonical R2 contract:
`.orchestration/contracts/ACP-2.6.9-R2-NATURAL-RECEPTIONIST.md`

## R2 execution sequence
1. `2.6.9-R2.1` — Receptionist Product Contract + Acceptance Corpus — **TECHNICAL_PASS / CLOSED**
2. `2.6.9-R2.2` — Natural Receptionist Dialogue Layer — **TECHNICAL_PASS / CLOSED**
3. `2.6.9-R2.3` — Durable Semantic Memory v2 — **REWORK / ACTIVE**
4. `2.6.9-R2.4` — Multi-Room Conversation Model — **BLOCKED BY R2.3**
5. `2.6.9-R2.5` — Multi-Room Reservation Orchestration
6. `2.6.9-R2.6` — Model Quality / Latency / Cost Evaluation
7. `2.6.9-R2.7` — Adversarial QA + Independent Critic
8. `2.6.9-R2.8` — Real-Model Receptionist Staging E2E
9. `2.6.9-R2.9` — Human Product Acceptance — Natural Receptionist

## R2.3 late-critic findings — ACTIVE REWORK
Fresh Codex review on merged PR #44 found:
- P1 — stale snapshot can roll back a newer `activeBookingId` / booking status;
- P1 — repeated affirmed child-category mentions overwrite rather than sum;
- P2 — conversation-backed snapshot parsing can swallow a scope-mismatch `FORBIDDEN` error;
- P2 — equal-revision concurrent active-intent conflicts do not advance global revision;
- P2 — clear negation is scoped to the whole message instead of the cue/clause it governs;
- P2 — reservation-control imperatives can still persist as lodging preferences.

These are automatic REWORK, not a Human Gate.

## Prior closure attempt — INVALIDATED
Historical attempt:
- Artifact A `35de13ba292d4bddb7554d0105abed982d42c39d`;
- exact-artifact CI `33356166030` — 121/121 PASS;
- PR #44 integration `8ad5eafd8bcfec077fa12a012c75b973291e1335`;
- post-merge CI `33356508067` — PASS.

Those results remain valid evidence for what they tested, but they do not satisfy the R2.3 exit gate after the late findings.

## Current objective
Fix all six late-critic findings with dedicated regressions while preserving:
- server ownership of semantic and operational authority;
- Tool Registry / Policy / HITL / exact approval-plan pinning;
- idempotency and booking ownership;
- tenant/hotel/actor/session isolation;
- HMS as source of operational truth;
- R2.3 single-stay scope only.

## Gate to R2.4
R2.4 remains blocked until R2.3 again has:
- exact-head CI PASS;
- dedicated regressions for all late-critic findings;
- QA PASS;
- Pre-Critic PASS;
- fresh Independent Critic PASS after all implementation changes;
- zero open P0/P1/P2;
- merge + post-merge regression PASS;
- source-of-truth convergence.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until `2.6.9-R2.9` receives explicit human `ACCEPT`.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, broader autonomous writes or second-vertical implementation is authorized during R2.
