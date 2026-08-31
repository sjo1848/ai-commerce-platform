# ACP 2.6.9-R2.3 — Late-Critic Reclosure Evidence

Status: `INDEPENDENT_CRITIC_PASS / INTEGRATION_READY`
Date: `2026-08-31`

## Scope
This evidence closes only the late-critic REWORK for `2.6.9-R2.3 — Durable Semantic Memory v2`.
R2.4 multi-room conversation and R2.5 execution remain out of scope and blocked until R2.3 integration and post-merge regression complete.

## Candidate invalidation history
The method invalidated multiple green candidates when fresh review found real defects before merge:
- `bbdaf81fe0cb602be5210a735222a59cdb6285ba` — model could still mutate/clear server-owned active booking grounding.
- `5c572501b0e84e213d87a82397d9c67a3fbe9f34` — later fresh review found incomplete status coverage plus clear/preference language edges.
- `aaa00561c2f3c7a9bd2a037111b5336d7a52a175` — fresh review found partial party correction, coordinated negation and reservation-noun edges.
- `3bb401fb347a7c3eda872f4a6d51af0e056749de` — fresh review found booking conflict revision could still be influenced by unrelated semantic revision and date-clear targeting could leak across clauses.

No invalidated candidate was merged.

## Final substantive Artifact A
- SHA: `29e3f52f8bc928f2ead2200a8cf0c7e18b1e2e6e`
- PR: `#45 — fix(2.6.9-R2.3): close late critic semantic-memory findings`
- Runtime files: `src/core/conversation-state.ts`, `src/core/llm-model.ts`
- Regression files:
  - `test/semantic-memory-r2.3-late-critic.test.mjs`
  - `test/semantic-memory-r2.3-critic-round3.test.mjs`
  - `test/semantic-memory-r2.3-critic-round4.test.mjs`
  - `test/llm-model.test.mjs`
- Artifact A is frozen. This evidence commit is Boundary B only.

## Exact-artifact CI
- core-ci run: `33378252316`
- foundation job: `99444502085`
- tests: `146/146 PASS`
- TypeScript typecheck: PASS
- staging E2 runner syntax: PASS
- Wrangler Worker dry-run: PASS

## Findings closed
1. P1 — stale snapshots cannot roll back newer `activeBookingId` / booking status.
2. P1 — model state patches cannot mutate or clear server-owned active booking grounding.
3. P1 — equal booking-state divergence always promotes `bookingStateRevision`, independent of unrelated semantic-memory revision, preventing later stale replay rollback.
4. P1 — repeated child aliases sum when distinct, while explicit category corrections replace the corrected category without losing unaffected categories.
5. P2 — conversation-backed semantic scope mismatch fails closed; malformed JSON remains skippable.
6. P2 — equal-revision active-intent conflicts advance semantic revision so stale replay cannot reverse the winner.
7. P2 — negated clear scope is cue-aware, including coordinated `no ... ni ...` chains.
8. P2 — clear targets are clause-owned for dates, guests and preferences; later references such as `y usa las fechas que ya te dije` do not become accidental clear targets.
9. P2 — operational reservation/cancellation/approval/processing language cannot poison durable lodging preferences.
10. P2 — legitimate lodging noun uses such as `reserva natural` and `reserva para observar aves` remain valid preferences while contextual reservation imperatives remain blocked.
11. P1/P2 test-quality findings — booking status states are distinguishable in stale regressions and every final substantive SHA has an ordinary exact-head CI run.

## Authority and safety invariants
- `bookingStateRevision` is server-owned, legacy-compatible and not model-visible.
- `activeBookingId` may be visible only as grounded planning context and is absent from model-writable `statePatch` schema/parser and the Core model-patch allowlist.
- tenant/actor/session semantic scope remains authoritative and fail-closed.
- user corrections/tombstones outrank stale model/tool snapshots under the existing semantic-memory rules.
- Registry, server validation, Policy, HITL, approval fingerprints, idempotency, trusted tenant/actor binding, ownership and HMS adapters are unchanged in authority.
- no multi-room state/execution, production expansion, payments or second vertical is introduced.

## QA
Verdict: `PASS`.
Open severities: `P0/P1/P2 = 0/0/0`.

QA reviewed the final PR diff, all adversarial regressions, exact-artifact CI and the full inline-review thread set. All review threads are resolved with evidence.

## Pre-Critic Gate
Verdict: `PASS`.

Pre-Critic invariants:
- substantive Artifact A frozen at `29e3f52f8bc928f2ead2200a8cf0c7e18b1e2e6e`;
- exact-artifact core-ci `33378252316` PASS with `146/146` tests;
- QA PASS with zero open P0/P1/P2;
- all late findings and later adversarial variants have dedicated regressions;
- no authority expansion to the LLM;
- R2.4 remains blocked until merge + post-merge main regression + source-of-truth convergence.

## Independent Critic
Controller Independent Critic review: `5065007457`.
Artifact reviewed: `29e3f52f8bc928f2ead2200a8cf0c7e18b1e2e6e`.
Verdict: `PASS`.
Open severities: `P0/P1/P2 = 0/0/0`.

External Codex review is unavailable because this repository has no Codex environment configured; the project method permits Controller to act as Independent Critic when separated from implementation.

## Integration gate
PR #45 may merge only if this Boundary B evidence commit keeps CI green and no new P0/P1/P2 appears before merge. After merge, `main` must pass the normal post-merge regression before R2.3 is marked closed and source-of-truth state/tracker advance to R2.4.
