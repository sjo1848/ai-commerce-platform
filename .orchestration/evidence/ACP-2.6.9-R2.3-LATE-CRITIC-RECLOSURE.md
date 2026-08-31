# ACP 2.6.9-R2.3 — Late-Critic Reclosure Evidence

Status: `PRE_CRITIC_PASS / ARTIFACT_FROZEN`
Date: `2026-08-31`

## Scope
This evidence covers only the late-critic REWORK for `2.6.9-R2.3 — Durable Semantic Memory v2`.
R2.4 multi-room conversation and R2.5 execution remain out of scope and blocked.

## Historical candidate invalidation
Candidate `bbdaf81fe0cb602be5210a735222a59cdb6285ba` passed `132/132` tests, but a fresh Controller critic found a P1 authority defect before merge: model `statePatch.activeBookingId` could still clear or replace server-owned booking grounding. Per method that candidate was invalidated and R2.3 returned to automatic REWORK.

The rework removed `activeBookingId` from the structured LLM state-patch schema/parser and from the server model-patch allowlist. The active booking may remain visible as grounded context for cancellation planning, but only server/tool execution may mutate booking grounding.

## Final substantive Artifact A
- SHA: `5c572501b0e84e213d87a82397d9c67a3fbe9f34`
- PR: `#45 — fix(2.6.9-R2.3): close late critic semantic-memory findings`
- Runtime files: `src/core/conversation-state.ts`, `src/core/llm-model.ts`
- Regression files: `test/semantic-memory-r2.3-late-critic.test.mjs`, `test/llm-model.test.mjs`
- Artifact A is frozen. Commits after this point are Boundary B evidence/orchestration only unless a critic finding reopens REWORK.

## Exact-artifact CI
- core-ci run: `33375876775`
- foundation job: `99437126674`
- tests: `135/135 PASS`
- TypeScript typecheck: PASS
- staging E2 runner syntax: PASS
- Wrangler Worker dry-run: PASS

## Late findings closed by final Artifact A
1. P1 — stale snapshots cannot roll back newer `activeBookingId` / booking status. Added server-owned `bookingStateRevision`, cancellation and stale-replay coverage.
2. P1 — repeated affirmed child categories are summed (`2 adultos + 1 niño + 1 niña = 4`).
3. P2 — valid scope mismatches in conversation-backed state merging escape parsing and fail closed; malformed JSON remains skippable.
4. P2 — equal-revision conflicting `activeIntent` values advance global semantic revision so stale replay cannot reverse the winner.
5. P2 — clear negation is scoped to the cue/segment it governs, supporting mixed positive/negated clear instructions in either order.
6. P2 — reservation/cancellation/approval control imperatives are rejected from durable lodging preferences.
7. Controller fresh-critic P1 — model state patches can no longer mutate or clear server-owned active booking grounding.

## Adversarial hardening
- stale pre-cancel snapshot cannot restore `CONFIRMED` after a newer `CANCELLED` state;
- equal booking revisions conflict once, advance booking revision, and stale replay cannot reverse the winner;
- model attempts to clear or forge `activeBookingId` fail the structured-router contract and are also stripped at the Core boundary;
- malformed persisted snapshot is ignored while a later valid scoped snapshot still loads;
- positive/negated clear cues work independently in both orders;
- reservation, cancellation, approval, processing and passive confirmation wording are rejected from durable lodging preferences.

## QA review
Verdict: `PASS`
Open severities: `P0/P1/P2 = 0/0/0`.

QA checked:
- `bookingStateRevision` is internal/server-owned, legacy-compatible and not model-visible;
- `activeBookingId` is available only as grounded planning context and is absent from model-writable `statePatch` schema/parser and Core model-patch allowlist;
- existing tenant/actor/session scope isolation remains authoritative;
- scope mismatch is no longer swallowed by broad parsing catch logic, while malformed JSON remains skippable;
- user stay memory, tombstones, corrections, concurrent merge and stale-tool protections remain green;
- HITL, approval fingerprints, idempotency, Registry, Policy, trusted tenant/actor binding and HMS adapters are untouched by this patch;
- no multi-room state or execution was introduced;
- full foundation suite remains green.

## Pre-Critic Gate
Verdict: `PASS`.

Pre-Critic invariants:
- substantive code frozen at final Artifact A `5c572501b0e84e213d87a82397d9c67a3fbe9f34`;
- exact-artifact core-ci `33375876775` PASS with `135/135` tests;
- QA PASS with zero open P0/P1/P2;
- all six late findings plus the additional Controller P1 have dedicated regressions;
- no authority expansion to the LLM;
- R2.4 remains blocked until Independent Critic PASS, PR #45 merge, post-merge main regression and source-of-truth convergence.

## Next gate
Independent Critic reviews final Artifact A `5c572501b0e84e213d87a82397d9c67a3fbe9f34`.
External Codex review is unavailable because this repository has no Codex environment configured; project method permits Controller to act as Independent Critic. The Controller review must remain distinct from implementation and must return zero P0/P1/P2 before integration.
