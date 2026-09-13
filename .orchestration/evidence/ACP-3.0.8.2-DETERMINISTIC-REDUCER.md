# ACP-3.0.8.2 — Deterministic Reducer Evidence

Status: `REVIEW_03 FINAL CANDIDATE / EXACT-HEAD CI PENDING`

## Prior exact-head evidence

- `d9466599dbaa6af75f986f2faf6d743562ad2627` — core-ci #640 / `34754777914` PASS.
- `b12751f6baeabfee3014c0e486a59a90786cce17` — core-ci #641 / `34754941366` PASS.

Those green runs did not close the reducer because adversarial review continued after CI.

## Review 01

Closed:
- optimistic revision guards for user/server mutations while tool observations remain dependency-based;
- terminal task fail-closed behavior;
- availability refresh invalidation of dependent grounding/prepared operations.

## Review 02

Closed:
- exact PreparedOperation → approval → execution → booking result authority chain;
- write-commit race: same task cannot rewrite an admitted/confirmed side effect;
- quote as a separate tool-authoritative observation namespace.

## Review 03

Closed final state-machine races:
- the single pending-tool slot rejects a second concurrent tool start instead of orphaning the first invocation;
- duplicate `execution_started` with a different event id is rejected;
- a new PreparedOperation cannot overwrite an active approval-bound operation;
- a task cannot transition terminal while an admitted side effect is still executing;
- task completion after a confirmed operation preserves the executed operation receipt instead of mislabeling it invalidated.

## Invariants

- No language parsing, tool selection, policy/approval decision, side-effect execution or response prose in Reducer.
- User/server mutations use optimistic revision guards.
- Tool results use causal invocation/dependency receipts and tolerate unrelated global revisions.
- Approval/execution/results remain exact-operation-bound.
- Booking facts are tool-authoritative.
- Failure does not erase requested semantics.
- Replay protection is bounded.

## Focused pre-push verification

Strict isolated TypeScript build: PASS.

- reducer tests: 21/21 PASS;
- compatibility projection tests: 4/4 PASS;
- total focused set: 25/25 PASS.

No provider inference, Worker deployment, HMS mutation or approval consumption occurred.

## Gate

`DETERMINISTIC_REDUCER_PASS` requires the Review 03 exact head to pass repository CI. No additional reducer expansion is planned unless that CI or a new contradiction produces a material finding.
