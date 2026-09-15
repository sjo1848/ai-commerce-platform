# ACP-3.0 — I0/I1 Implementation Entry

Status: ACTIVE / REWORK APPLIED — EXACT-HEAD REVALIDATION PENDING
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
3. introduce collision-resistant causal dependency fingerprints;
4. add a one-way ConversationState -> TaskState migration adapter;
5. add contract regressions proving authority separation.

## Allowed

- additive TypeScript contracts under `src/cognitive/`;
- additive migration adapter from current ConversationState;
- additive contract tests;
- bounded documentation/evidence;
- bounded exact-head CI after each substantive rework candidate.

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

I3. Legacy operational compatibility data MUST NOT be inserted into ACP-3.0 `ToolObservations` or `ServerControlState`. The adapter returns it separately as `LegacyCompatibilitySnapshot`; migration logic may use that snapshot only to decide what must be freshly re-observed/re-grounded.

I4. ACP-3.0 `AvailabilityObservation`, `QuoteObservation` and `BookingObservation` are tool-authoritative only. `GroundedSelection` is server-authoritative only. There is no `legacy_migration` member in those authority-bearing unions.

I5. Only requested stay facts whose legacy provenance is `user` or `legacy` may seed `TaskState.user.stay`. `tool` or `server` provenance must not be silently recast as user-requested semantics. The same rule applies to legacy active intent before it can seed `requestedGoal`.

I6. Unprovenanced legacy room count/selection/occupancy/booking state remains compatibility-only until a later migration stage re-observes/re-grounds it.

I7. ACP-3.0 starts a fresh `stateRevision` domain at revision 0. Legacy semantic/room/booking revisions are provenance only and cannot become the new global staleness criterion.

I8. Dependency fingerprints are deterministic SHA-256 identities over canonical bounded dependency projections because their equality participates in stale/pre-write revalidation. They still do not replace authorization, HITL, policy, signatures or idempotency.

I9. No runtime path consumes these contracts yet. I0/I1 are additive and inert.

## Adversarial Review 01

Initial exact-head candidate `41d452ecaa336914d496f4b24ffed7679a69c056` passed full `core-ci` run `34923551083`, but architecture-oriented review found two substantive P1-class boundary weaknesses before I1 closure:

1. `legacy_migration` shared the same authority-bearing observation/grounding types as fresh tool/server truth. A future consumer could accidentally satisfy Planner/Core preconditions with a migration snapshot.
2. dependency fingerprints used 64-bit FNV-1a even though equality participates in causal staleness/pre-write revalidation. Collision resistance was too weak for that role.

Disposition: REWORK inside I1; do not advance to I2 on the initial green candidate.

Required repair:
- quarantine legacy operational state outside TaskState authority namespaces;
- seed only provenance-supported requested semantics;
- restart ACP-3.0 state revision domain at 0;
- use canonical SHA-256 dependency fingerprints;
- rerun exact-head full CI and adversarial QA before closure.

## Exit criteria

- TypeScript compiles under strict/exactOptionalPropertyTypes.
- New ACP-3.0 contract tests pass.
- Existing suite remains green.
- Reworked exact branch HEAD receives bounded `core-ci` PASS.
- Adversarial Engineering QA on the reworked exact HEAD finds no open P0/P1 boundary defect.
- No product/runtime behavior changes.

## Next block if PASS

I2 — deterministic TaskState reducer + typed TaskEvents + causal invalidation, still behind the migration boundary and without changing Core/Executor authority.
