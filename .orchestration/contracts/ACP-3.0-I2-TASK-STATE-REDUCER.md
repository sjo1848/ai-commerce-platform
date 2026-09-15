# ACP-3.0 — I2 Task State Reducer Implementation Contract

Status: ACTIVE / CANDIDATE
Mode: IMPLEMENTATION
Prerequisite: I0/I1 exact gated head `a015617dcacd8066055cbe8250c06523a010f9ce` = PASS
Branch: `feature/acp-3.0-i2-task-state-reducer`

## Objective

Implement the first pure deterministic ACP-3.0 Task State reducer without enabling the new cognitive runtime path.

Contract:

`TaskState + TaskEvent -> TaskStateReduction`

Persistence, planning, tool execution, policy, approvals, model calls and response generation remain outside the reducer.

## Scope

I2 adds:

1. `sessionId` + bounded recent event window to TaskState;
2. exactly three typed authority classes: UserSemanticEvent, ToolObservationEvent, ServerControlEvent;
3. revision/scope/idempotency admission;
4. explicit set/clear user patch semantics;
5. tool observation promotion only through current invocation/operation authority;
6. server-only grounding application;
7. causal invalidation through artifact-declared dependency paths;
8. bounded invocation lifecycle/failure state;
9. prepared-operation/approval state recording without policy decisions;
10. pure synthetic transition tests including J01 state traversal.

## Non-negotiable authority

- UserSemanticEvent may write only requested user semantics.
- ToolObservationEvent may write only validated operational observations/failures/outcomes.
- ServerControlEvent may write only server/control/grounding/lifecycle state.
- Symbolic/contextual reference resolution is NOT performed by Reducer. Reducer only validates/applies `reference_grounded` emitted by the future bounded server Reference Resolver.
- Approval requirement/grant is NOT decided by Reducer. Reducer only records trusted server/Core control transitions.
- No event executes a tool.

## Causal invalidation

Reducer does not hardcode a hotel workflow cascade.

Every derived artifact carries:
- `dependencyFingerprint`;
- bounded `dependencyPaths` selected by the domain contract/boundary that created the artifact.

Reducer records actual changed semantic paths and invalidates only artifacts whose declared paths intersect those changes. Invalidating one artifact emits its own path into the same bounded cascade so downstream dependencies invalidate transitively.

Examples:
- a preference change does not invalidate availability unless that availability explicitly depends on preferences;
- a stay correction invalidates a matching availability only when the availability declares that stay path;
- invalidated availability can then invalidate a selection that declares `observations.availability`;
- invalidated selection can then invalidate a PreparedOperation that declares `control.groundedSelection`.

`stateRevision` remains optimistic concurrency only, not semantic staleness.

## Invocation liveness

A current invocation records admitted/dispatched/terminal lifecycle plus lease/recovery metadata. Relevant dependency changes mark an admitted/dispatched invocation `superseded`. Late observations from non-current/non-active authority are rejected and cannot become operational truth.

No business auto-retry is implemented in Reducer.

## Replay/concurrency

- wrong session/task -> reject;
- duplicate eventId within bounded recent window -> accepted idempotent no-op;
- stale `expectedStateRevision` -> conflict/reject;
- a first-time accepted event increments stateRevision exactly once and records eventId;
- persistence/CAS remains outside Reducer.

## Fail-closed validation

Reducer validates basic state invariants independently of upstream schema validation:
- ISO calendar dates and ordered stay ranges;
- positive bounded guests/room count;
- bounded occupancy consistency;
- current observation membership for server grounding;
- exact invocation/operation identity for tool observations;
- legal PreparedOperation status transitions;
- legal task lifecycle transitions.

Malformed or stale authority never produces partial state mutation.

## Explicit non-goals

I2 does NOT:
- integrate TaskState into ChatOrchestrator/runtime;
- implement Reference Resolver;
- implement TaskDefinition/DomainCapabilities;
- implement Planner;
- call provider/LLM;
- call HMS;
- execute writes;
- consume human approval;
- deploy;
- replace current persistence;
- implement full event sourcing;
- merge PR #63 or I1 PR #68.

## Gate

`I2_TASK_STATE_REDUCER_PASS` requires:

- strict TypeScript build PASS;
- all existing tests PASS;
- pure reducer authority tests PASS;
- duplicate/stale revision tests PASS;
- late/superseded tool observation rejection PASS;
- irrelevant change preserves unrelated derived truth PASS;
- relevant change causal cascade PASS;
- server-only grounding PASS;
- approval-required bypass prevention PASS;
- synthetic J01 state-transition test PASS without LLM or real tool calls;
- adversarial exact-head review with no open P0/P1;
- no runtime behavior changes.

I3 (HotelTaskDefinition + DomainCapabilities + deterministic Planner) remains BLOCKED until this gate closes.
