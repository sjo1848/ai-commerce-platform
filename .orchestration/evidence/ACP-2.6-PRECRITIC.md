# ACP 2.6 — Pre-Critic Gate

Status: `READY FOR INDEPENDENT CRITIC`
Date: 2026-08-30
Task: `ACP-2.6-HMS-AGENTIC-EXPERIENCE`
PR: `#21`

## Immutable substantive artifact — Boundary A

Artifact A is frozen at:

`ad794989d2299a99ad8aae46689411c6d55915fa`

No substantive source, runtime configuration or test code is permitted after this SHA without invalidating this Pre-Critic gate and creating a new Artifact A.

Automated evidence on exact Artifact A:

- `core-ci` run `33316738878` — **SUCCESS**;
- TypeScript strict typecheck — PASS;
- Node tests — **69/69 PASS**, 0 failed/skipped/todo;
- staging E2E runner syntax — PASS;
- `wrangler deploy --dry-run` — PASS;
- Cloudflare bindings resolved: `SESSIONS`, HMS Service Binding, `AI`.

## Orchestration/evidence-only boundary — Boundary B

Commits after Artifact A and before this Pre-Critic record are evidence-only:

- `341d54364fd07ab98f0a6ee909e24640a1e8c3f7` — frozen corpus interpretation addendum;
- `befec4b0d3965b5b5040241e12480188b3d4f3d8` — adversarial QA evidence.

Comparison `ad794989..befec4b0` contains only:

- `.orchestration/evidence/ACP-2.6.1-CORPUS-INTERPRETATION.md`;
- `.orchestration/evidence/ACP-2.6-ADVERSARIAL-QA.md`.

Therefore Boundary B does not mutate Artifact A.

## Preconditions satisfied

- 2.6.1 corpus frozen before model implementation and unchanged.
- 2.6.2 provider-independent model abstraction implemented.
- 2.6.3 model-safe schemas + trusted-field isolation + executor revalidation implemented.
- 2.6.4 bounded server-owned conversational memory implemented and trusted metadata redacted.
- 2.6.5 factual response grounding is deterministic by construction; model is limited to bounded presentation decision.
- 2.6.6 model/tokens/latency/cost/fallback telemetry, timeout and no-auto-retry policy implemented.
- 2.6.7 adversarial implementation QA PASS on Artifact A.

## Mandatory Independent Critic questions

The critic must review code and tests, not merely accept this summary, with particular focus on:

1. Can any model/user-controlled value elevate tenant, hotel, actor, permissions, guest identity, approval or idempotency authority?
2. Is exact-operation HITL still valid when routing is probabilistic and conversational?
3. Can a second model invocation or conversation/tool injection fabricate operational facts or trigger a side effect?
4. Does conversation memory reveal trusted routing/execution metadata unnecessarily?
5. Can provider failure/timeout relax policy or cause automatic retry amplification?
6. Is trusted guest canonicalization included before approval fingerprinting and rechecked before HMS mutation?
7. Does deterministic fallback preserve safety and current model-visible schema semantics?
8. Are any P0/P1/P2 issues still open that would make staging promotion unsafe?

## Critic outcomes

- `PASS` → integrate Artifact A, post-merge regression gate, then 2.6.8 real-model staging experiment.
- `REWORK` → Artifact A invalidated; return automatically to implementation, fix, retest, freeze a new artifact and repeat Pre-Critic.
- `BLOCKED` → record exact external blocker.
- `HUMAN_GATE` → only if a genuine product/risk/spend/security decision requires the Product/Risk Authority.

This gate is not Product Acceptance and does not unblock Fase 3.
