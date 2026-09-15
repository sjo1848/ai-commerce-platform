# ACP-3.0 — I0/I1 Implementation Entry

Status: ACTIVE
Mode: IMPLEMENTATION
Human Gate: ACP3_IMPLEMENTATION_START = APPROVED
Base product SHA: 10c649507b524c44fc4ed4fd1d0dd1e63cd13185
Source branch: feature/r2.8.4-nlu-boundary-rework
Implementation branch: feature/acp-3.0-i0-i1-cognitive-contracts

## Objective

Start ACP-3.0 implementation incrementally without rewriting Core/Executor and without contaminating the still-open R2.8.4 branch.

This block implements only I0/I1:

1. freeze exact implementation baseline;
2. introduce shared cognitive contracts;
3. introduce stable causal dependency fingerprints;
4. add a one-way ConversationState -> TaskState migration adapter;
5. add contract regressions proving authority separation.

## Allowed

- additive TypeScript contracts under `src/cognitive/`;
- additive migration adapter from current ConversationState;
- additive contract tests;
- bounded documentation/evidence;
- one bounded CI run after local-independent static review is complete.

## Forbidden

- modifying PR #63;
- provider calls;
- deployment;
- HMS writes;
- approval consumption;
- Core/Executor rewrite;
- replacing ConversationState persistence yet;
- changing current R2.8.4 gates/status;
- enabling the ACP-3.0 orchestration path in production/runtime;
- generalizing to a second vertical.

## I1 invariants

I1. `requestedGoal` and `operationIntent` remain separate. Legacy `activeIntent` must never fabricate an executable commit.

I2. User-derived semantics never become operational truth merely because they were persisted in ConversationState.

I3. Legacy availability may seed a migration observation only when its exact stay query is complete and candidates exist. It is explicitly marked `legacy_migration`.

I4. Legacy selection can seed `groundedSelection` only against the migration availability observation and remains marked `legacy_migration`.

I5. Legacy booking identity stays in the observation namespace. It cannot fabricate `bookingReference`, cancel intent or policy state.

I6. Dependency fingerprints are deterministic causal identities only. They do not replace authorization, HITL, policy, signatures or idempotency.

I7. No runtime path consumes these contracts yet. I0/I1 are additive and inert.

## Exit criteria

- TypeScript compiles under strict/exactOptionalPropertyTypes.
- New ACP-3.0 contract tests pass.
- Existing suite remains green.
- Exact branch HEAD receives one bounded core-ci run.
- Engineering QA reviews exact HEAD independently.
- No product/runtime behavior changes.

## Next block if PASS

I2 — deterministic TaskState reducer + typed TaskEvents + causal invalidation, still behind the migration boundary and without changing Core/Executor authority.
