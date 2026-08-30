# ACP 2.6 — Pre-Critic Gate

Status: `READY FOR INDEPENDENT CRITIC`
Date: 2026-08-30
Task: `ACP-2.6-HMS-AGENTIC-EXPERIENCE`
PR: `#21`

## Immutable substantive artifact — Boundary A

Artifact A is frozen at:

`56ba62d5fc903ce2c387e5bf91d4f1b89b1e700e`

The previous candidate `ad794989d2299a99ad8aae46689411c6d55915fa` is explicitly invalidated because later commits modified runtime and tests.

Automated evidence on exact current Artifact A:

- `core-ci` run `33317116664` — **SUCCESS**;
- TypeScript strict typecheck — PASS;
- Node tests — **73/73 PASS**, 0 failed/skipped/todo;
- staging E2E runner syntax — PASS;
- `wrangler deploy --dry-run` — PASS;
- Cloudflare bindings resolved: `SESSIONS`, HMS Service Binding and `AI`.

## Boundary B

Commits after Artifact A may only change orchestration/evidence. Any source/runtime/test/config mutation invalidates this gate.

The first Boundary B commit is `ed600798f5258c241070f04ddd20a96137913d3e`, which refreshes adversarial QA evidence only.

## Preconditions satisfied

- 2.6.1 frozen conversational/adversarial corpus remains unchanged.
- 2.6.2 provider-independent `ModelProvider` / `LLMModelRouter` implemented.
- 2.6.3 model-visible schemas expose business fields only; trusted authority is server-owned and executor revalidated.
- 2.6.4 bounded server-owned conversation context implemented; trusted metadata is recursively redacted before model memory.
- 2.6.5 operational facts are deterministically rendered from tool results; model is limited to bounded response decision.
- 2.6.6 inference telemetry, token/cost estimate, timeout and zero-auto-retry fallback policy implemented.
- 2.6.7 adversarial QA PASS on current Artifact A.
- trusted staging guest identity is canonicalized from tenant+actor before operation fingerprinting and rechecked before HMS mutation.
- HITL stores the exact validated canonical tool plan and executes that stored plan without re-routing the model after approval.

## Independent Critic questions

1. Can model/user-controlled data elevate tenant, hotel, actor, permissions, guest identity, approval or idempotency authority?
2. Is HITL bound to the exact canonical operation despite probabilistic routing?
3. Can response-model or conversation/tool injection fabricate operational facts or cause a side effect?
4. Does memory expose trusted execution metadata unnecessarily?
5. Can provider failure/timeout relax policy or amplify retries/cost?
6. Is trusted guest identity bound before fingerprinting and revalidated before mutation?
7. Does fallback preserve safety and model-visible schema semantics?
8. Are any P0/P1/P2 issues open that make staging promotion unsafe?

## Outcomes

- `PASS` → integrate Artifact A, post-merge regression gate, then 2.6.8 real Workers AI staging experiment.
- `REWORK` → invalidate Artifact A, repair automatically, retest and refreeze.
- `BLOCKED` → record exact external blocker.
- `HUMAN_GATE` → only for genuine product/risk/spend/security authority.

This gate is not Product Acceptance and does not unblock Fase 3.