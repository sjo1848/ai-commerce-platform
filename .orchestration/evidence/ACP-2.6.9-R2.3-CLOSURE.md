# ACP 2.6.9-R2.3 — Durable Semantic Memory v2 — Closure Attempt

Status: `INVALIDATED / REWORK`
Closure attempt date: `2026-08-31`
Invalidated: `2026-08-31`

## Why this closure is invalidated
The initial R2.3 closure attempt had exact-artifact CI, QA, Pre-Critic, Independent Critic, merge and post-merge regression PASS. A later fresh Codex review completed after PR #44 had already merged and surfaced six additional technical findings. Per the project method, P1/P2 findings automatically invalidate technical closure and reopen REWORK.

## Historical closure attempt
- Artifact A: `35de13ba292d4bddb7554d0105abed982d42c39d`
- Exact-artifact core-ci: `33356166030` — `121/121 PASS`
- PR #44 integration: `8ad5eafd8bcfec077fa12a012c75b973291e1335`
- Post-merge core-ci: `33356508067` — `121/121 PASS`

These remain valid historical evidence only; they no longer satisfy the R2.3 exit gate.

## Late fresh-critic findings — OPEN
1. P1 — preserve newer booking grounding during snapshot merges; stale snapshots can otherwise roll back `activeBookingId` / booking status.
2. P1 — sum repeated affirmed child-category mentions (`2 adultos, 1 niño y 1 niña` must equal 4).
3. P2 — scope mismatch errors from conversation-backed snapshot merges must escape parsing and fail closed.
4. P2 — concurrent equal-revision active-intent conflicts must advance global revision so stale replays cannot reverse intent.
5. P2 — clear negation must be scoped to its own cue/clause (`No olvides las fechas; borra la cantidad`).
6. P2 — reservation-control imperatives must be rejected from durable lodging preferences.

Open severity after late review: `P0/P1/P2 = 0/2/4`.

## Gate
R2.3 remains `REWORK` until all six findings have dedicated regressions, exact-head CI PASS, QA PASS, Pre-Critic PASS, fresh Independent Critic PASS with zero P0/P1/P2, merge, post-merge regression and source-of-truth convergence.

R2.4 is blocked. R2.5 and Fase 3 remain blocked by their existing gates.

Verdict: `CLOSURE_INVALIDATED_REWORK`
