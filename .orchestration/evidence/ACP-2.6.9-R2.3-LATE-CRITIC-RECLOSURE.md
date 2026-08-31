# ACP 2.6.9-R2.3 — Late-Critic Reclosure Evidence

Status: `PRE_CRITIC_PASS / ARTIFACT_FROZEN`
Date: `2026-08-31`

## Scope
This evidence covers only the late-critic REWORK for `2.6.9-R2.3 — Durable Semantic Memory v2`.
R2.4 multi-room conversation and R2.5 execution remain out of scope and blocked.

## Substantive Artifact A
- SHA: `bbdaf81fe0cb602be5210a735222a59cdb6285ba`
- PR: `#45 — fix(2.6.9-R2.3): close late critic semantic-memory findings`
- Changed runtime file: `src/core/conversation-state.ts`
- Dedicated regression file: `test/semantic-memory-r2.3-late-critic.test.mjs`
- Artifact A is frozen. Commits after this point are Boundary B evidence/orchestration only unless a critic finding reopens REWORK.

## Exact-artifact CI
- core-ci run: `33375270276`
- foundation job: `99435217571`
- tests: `132/132 PASS`
- TypeScript typecheck: PASS
- staging E2 runner syntax: PASS
- Wrangler Worker dry-run: PASS

## Late findings closed by Artifact A
1. P1 — stale snapshots cannot roll back newer `activeBookingId` / booking status. Added server-owned `bookingStateRevision` and stale replay coverage.
2. P1 — repeated affirmed child categories are summed (`2 adultos + 1 niño + 1 niña = 4`).
3. P2 — valid scope mismatches in conversation-backed state merging escape parsing and fail closed; malformed JSON remains skippable.
4. P2 — equal-revision conflicting `activeIntent` values advance global semantic revision so stale replay cannot reverse the winner.
5. P2 — clear negation is scoped to the cue/segment it governs, supporting mixed positive/negated clear instructions in either order.
6. P2 — reservation/cancellation/approval control imperatives are rejected from durable lodging preferences.

## Adversarial hardening beyond the original six examples
- stale pre-cancel snapshot cannot restore `CONFIRMED` after a newer `CANCELLED` state;
- equal booking revisions conflict once, advance booking revision, and stale replay cannot reverse the resulting active booking;
- malformed persisted snapshot is ignored while a later valid scoped snapshot still loads;
- positive guest clear remains effective when a later date-clear cue is negated;
- cancellation and approval control verbs are rejected from preference persistence.

## QA review
Verdict: `PASS`
Open severities: `P0/P1/P2 = 0/0/0`.

QA checked:
- `bookingStateRevision` is internal/server-owned: it is not part of model `statePatch` and is not included in model-visible state;
- existing tenant/actor/session scope isolation remains authoritative;
- scope mismatch is no longer swallowed by broad parsing catch logic;
- durable-memory legacy parsing remains supported;
- HITL, approval fingerprints, idempotency, Registry, Policy, trusted tenant/actor binding and HMS adapters are untouched by this patch;
- no multi-room state or execution was introduced;
- full foundation suite remains green.

## Pre-Critic Gate
Verdict: `PASS`.

Pre-Critic invariants:
- substantive code frozen at Artifact A;
- exact-artifact CI PASS;
- QA PASS with zero open P0/P1/P2;
- all six late findings have dedicated regressions;
- additional cancellation/replay/poisoning variants are covered;
- no authority expansion to the LLM;
- R2.4 remains blocked until a fresh Independent Critic passes, PR #45 merges, post-merge main regression passes, and source-of-truth converges.

## Next gate
Fresh Independent Critic must review Artifact A `bbdaf81fe0cb602be5210a735222a59cdb6285ba`.
If it returns P0/P1/P2, this evidence is invalidated and R2.3 automatically returns to REWORK.
If it passes, merge PR #45, run post-merge main CI, then update STATE/STATUS/closure evidence/tracker and mark R2.3 `TECHNICAL_PASS / CLOSED`.
