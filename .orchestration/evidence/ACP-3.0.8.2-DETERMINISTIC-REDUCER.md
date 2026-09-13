# ACP-3.0.8.2 — Deterministic Reducer Evidence

Status: `REVIEW_02 AMENDED / EXACT-HEAD CI PENDING`

## Review 01

Initial candidate `d9466599dbaa6af75f986f2faf6d743562ad2627` passed `core-ci` run `34754777914` / #640.

Review 01 then closed three contract gaps:
- optimistic revision guards for user/server mutations while tool observations remain dependency-based;
- terminal task fail-closed behavior;
- availability refresh invalidation of grounding/prepared operations that depended on the replaced observation.

Review 01 amended head `b12751f6baeabfee3014c0e486a59a90786cce17` passed `core-ci` run `34754941366` / #641.

## Review 02 findings

CI green still did not prove that the reducer could represent the full J01 control/result chain.

### F4 — approval/execution/outcome authority was incomplete

The reducer now models:
`PreparedOperation -> approval state -> execution_started -> exact booking outcome`.

Approval can only advance the exact operationId + operationFingerprint + dependencyFingerprint. Execution cannot start while status is `approval_required`; it requires `prepared` (auto path) or `approved` (HITL path).

Mutation results are accepted only for the exact executing operation.

### F5 — write-commit race

After execution is `executing` or `confirmed`, user semantic mutation in that same task fails closed as `EXECUTION_ALREADY_COMMITTED`. A later change must be represented through a new task/flow rather than pretending to rewrite a side effect already admitted.

### F6 — quote observation missing from TaskState implementation

Quote now has a separate tool-authoritative observation namespace and the same invocation/dependency stale controls as availability.

## Preserved invariants

- Reducer never parses language, chooses tools, decides policy, executes side effects or writes user prose.
- User/server mutations use optimistic state revision guards.
- Tool observations do not require global revision equality and remain causal by receipts.
- Approval authority remains server/Core-owned and exact-operation-bound.
- Booking outcomes are tool-authoritative.
- Failure does not erase requested semantics.
- Replay protection remains bounded.

## Focused pre-push verification

Strict isolated TypeScript build: PASS.

Focused tests:
- deterministic reducer: 16/16 PASS;
- compatibility projection: 4/4 PASS;
- combined: 20/20 PASS.

No provider inference, Worker deployment, HMS mutation or approval consumption occurred.

## Gate

`DETERMINISTIC_REDUCER_PASS` remains pending repository CI on the Review 02 exact head.
