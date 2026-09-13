# ACP-3.0.8.2 — Deterministic Reducer Evidence

Status: `REVIEW_01_AMENDED / EXACT-HEAD CI PENDING`

## Initial candidate

- Candidate head: `d9466599dbaa6af75f986f2faf6d743562ad2627`.
- `core-ci` run `34754777914` / #640: PASS.
- Typecheck + full tests, staging E2E syntax and Wrangler config all passed.

CI green did not close the gate by itself.

## Review 01 findings

### F1 — missing optimistic concurrency guard for user/server mutations

Tool observations must remain causal and must not require exact global stateRevision, but user/server mutations need an expected revision so concurrent accepted changes cannot silently overwrite each other.

Amendment:
- user semantic and server-control events carry `expectedStateRevision`;
- mismatch fails closed as `STATE_REVISION_CONFLICT`;
- availability tool results continue to use invocationId + dependencyFingerprint rather than global revision equality.

### F2 — terminal tasks could still accept later mutation events

A completed/abandoned/superseded task must not be rewritten to represent a new user intent.

Amendment:
- non-replay events on non-active tasks fail closed with `TASK_NOT_ACTIVE`;
- moving a task terminal supersedes pending tool work and invalidates prepared operations.

### F3 — availability refresh replaced current observation without staling dependent grounding

Because the current v1 state holds one availability slot, moving that slot to `pending` must invalidate grounding/prepared operations that explicitly depend on `availability`.

Amendment:
- starting a new availability invocation emits causal invalidation for dependents on `availability`.

## Invariants preserved

- Reducer never parses user language.
- Reducer never chooses a tool.
- Reducer never decides policy/approval.
- Reducer never executes side effects or writes user prose.
- User requested semantics, tool observations and server controls remain separate authority paths.
- Unrelated state revisions do not make a tool observation stale when its dependency fingerprint remains valid.
- Duplicate accepted event IDs are bounded and do not apply effects twice.

## Focused pre-push verification

Isolated strict TypeScript build: PASS.

Focused behavioral set:
- reducer: 11/11 PASS;
- compatibility projection: 4/4 PASS;
- combined: 15/15 PASS.

No provider inference, Worker deployment, HMS mutation or approval consumption occurred.

## Gate

`DETERMINISTIC_REDUCER_PASS` remains pending exact-head repository CI after Review 01 amendments.
