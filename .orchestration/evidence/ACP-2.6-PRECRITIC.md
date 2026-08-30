# ACP 2.6 — Pre-Critic Gate

Status: `READY FOR INDEPENDENT CRITIC`
Date: 2026-08-30
Task: `ACP-2.6-HMS-AGENTIC-EXPERIENCE`
PR: `#26`

## Immutable substantive artifact — Boundary A

Artifact A is frozen at:

`c7cfc1f5a33131ee538966bce6fcdf6d7168a195`

Prior candidates `56ba62d...` and `ad794989...` are invalidated for current Product Correctness. `56ba62d...` passed technical/adversarial QA but failed the real Workers AI staging natural-language gate: availability intent was misclassified as requiring a prior room/selection.

Exact current automated evidence:

- `core-ci` run `33318023377` — **SUCCESS**;
- TypeScript strict typecheck — PASS;
- Node tests — **74/74 PASS**, 0 failed/skipped/todo;
- staging E2E reservation runner syntax — PASS;
- `wrangler deploy --dry-run` — PASS;
- Cloudflare bindings resolved: `SESSIONS`, HMS Service Binding and `AI`.

## Runtime rework reviewed

`src/core/llm-model.ts` now makes critical arguments capability-specific:

- availability/search (`hms.checkAvailability`) requires dates + guests only;
- room/selection/booking is explicitly forbidden as a prerequisite for availability;
- quote requires grounded room/reference + dates and may reuse prior dates;
- reservation requires grounded room/reference + dates while guest identity remains server-bound;
- cancellation requires a grounded owned booking/reference;
- ordinary Argentine-Spanish date phrasing and the exact natural availability pattern observed failing in staging are included as routing examples.

Regression coverage: `test/llm-routing-contract.test.mjs` locks the capability-specific prompt contract and premature-selection prohibition.

## Boundary B

Commits after Artifact A may only change orchestration/evidence. Any source/runtime/test/config mutation invalidates this gate.

## Security/governance invariants retained

- visible Tool Registry remains authoritative;
- trusted tenant/hotel/actor/guest/permissions/approval/idempotency fields remain server-owned;
- canonical trusted guest identity is injected before approval fingerprinting and rechecked before HMS mutation;
- exact validated write plan is stored in the single-use HITL challenge and executed without model rerouting after approval;
- cancellation remains bound to trusted session ownership/original create token;
- conversation history remains bounded and trusted metadata redacted;
- operational facts remain deterministically grounded in tool results;
- provider timeout/failure keeps zero automatic retries and deterministic safe fallback.

## Independent Critic questions

1. Did the natural-intent fix change only semantic routing guidance, or did it accidentally weaken any authority boundary?
2. Does availability now clearly avoid room/selection requirements while quote/reserve/cancel retain grounded-reference requirements?
3. Can the new examples induce invented IDs, trusted fields or self-approval?
4. Are all existing HITL/idempotency/ownership/memory/grounding invariants still covered and green?
5. Is there any P0/P1/P2 issue that blocks another real-model staging run?

## Outcomes

- `PASS` → integrate → post-merge regression → rerun 2.6.8 real Workers AI staging evaluator.
- `REWORK` → invalidate Artifact A, repair automatically, retest and refreeze.
- `BLOCKED` → record exact external blocker.
- `HUMAN_GATE` → only for genuine product/risk/spend/security authority.

This gate is not Product Acceptance and does not unblock Fase 3.