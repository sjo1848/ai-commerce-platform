# ACP 2.6.9 — Structured Conversation State REWORK — Pre-Critic Gate

Date: 2026-08-30

## Artifact A

Immutable substantive artifact:

`6315fbad5c0ba724021095efa9716b1a41791962`

All commits after Artifact A on PR #34 are orchestration/evidence only. Any subsequent code, runtime, test or evaluator logic change invalidates this gate and requires a new Artifact A.

## Scope reviewed

- `src/core/conversation-state.ts`
- `src/core/types.ts`
- `src/core/llm-model.ts`
- `src/core/deterministic-model.ts`
- `src/core/orchestrator.ts`
- `src/core/runtime.ts`
- `src/worker.ts`
- `test/conversation-state.test.mjs`
- LLM routing/telemetry contract tests
- `scripts/staging-real-model-eval.mjs`

## Automated gate

`core-ci` run `33321518940`: PASS on Artifact A.

- typecheck PASS
- tests 80/80 PASS
- staging runner syntax PASS
- Cloudflare dry-run PASS

## QA gate

`.orchestration/evidence/ACP-2.6.9-STATE-REWORK-QA.md`: PASS.

No open P0/P1/P2.

## Invariants retained

- LLM interprets natural language but does not own authority.
- Structured state is server-side and session-scoped.
- HMS results are authoritative for rooms/bookings.
- Model-selected room state is bounded to HMS-returned candidates.
- trusted tenant/hotel/actor/guest/approval/idempotency metadata cannot be supplied through model state.
- write tools still require Policy/HITL.
- approval executes the exact validated frozen plan.
- deterministic fallback cannot elevate permissions and now reuses the same state.

## Pre-Critic verdict

`PASS`

Ready for Independent Critic on Artifact A `6315fbad5c0ba724021095efa9716b1a41791962`.
