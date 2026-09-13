# ACP-3.0.8.6.A — Observation Mapper + Replan Evidence

Status: `OBSERVATION_MAPPER_REPLAN_PASS`
Gate head: `9abbf75390d568765f293269569d645acdf36a29`
Authoritative CI: core-ci #654 / `34770532449`
Tests: `488/488 PASS`
Runtime cutover: `false`
Real provider calls: `false`
HMS mutations: `false`

## Scope proven

The offline tool-outcome path is now bounded as:

`typed/raw tool outcome -> Observation Mapper -> TaskEvent -> Reducer -> TaskState -> deterministic Planner`

The Mapper is the only ACP-3 boundary that sees raw supported tool results. Planner receives only reduced TaskState and normalized control state; raw HMS payloads and exception prose do not enter planning.

## Read observations

- availability and quote outcomes bind to the exact pending `invocationId` and dependency fingerprint already present in TaskState;
- late/superseded invocation results fail closed before promotion;
- result shape is validated against the admitted input snapshot;
- zero availability is preserved as business truth, not converted into failure or retry;
- HMS availability explicitly records that guest-capacity coverage is `not_modeled` when `capacityFilterApplied=false`; ACP does not claim that a room supports the requested party size without evidence;
- normalized room observations exclude raw trace IDs, hotel IDs, prices and other fields that are not part of the TaskState observation contract;
- quote truth promotes only the exact grounded room and amount/currency returned for the admitted stay.

## Write outcomes

- single reservation/cancellation outcomes bind to the exact executing operation triple;
- multi-room create/cancel results are reduced atomically so one logical composite operation cannot be incorrectly confirmed by only its first child result;
- confirmed multi-create preserves every real booking ID;
- compensation failure preserves surviving booking truth while marking execution failed;
- partial group cancellation preserves the cancelled subset while marking the operation failed;
- executor failures are normalized to bounded failure codes; raw exception/prose is never treated as operational truth.

## Reducer contract extension

ACP-3 TaskEvent/Reducer now supports atomic grouped outcomes and partial outcomes. Planner-facing execution semantics remain bounded to confirmed vs failed; the workflow vocabulary was not expanded merely because HMS returned multiple child bookings.

## Candidate history

Initial candidate `2190514e2170a1584d61f39a41a29e968804ebc7` ran as core-ci #653 / `34770094605` and failed `483/486` with three identical behavioral failures. Mapping/reduction had succeeded, but Planner returned `WAIT` because an old approved `PreparedOperation` was checked before `execution.failed`.

This exposed a real priority bug: observed execution failure must outrank stale approval/prepared state, while an explicit new read remains serviceable.

Rework `9abbf75390d568765f293269569d645acdf36a29` moved failure priority ahead of stale prepared wait and added direct regressions for:
- execution failure outranking old approval state;
- explicit quote read remaining serviceable after a prior execution failure.

core-ci #654 / `34770532449` passed typecheck, all `488/488` tests, staging E2E syntax validation and Wrangler dry-run.

## Gate verdict

`OBSERVATION_MAPPER_REPLAN_PASS`

Next sub-block: `ACP-3.0.8.6.B — ResponseContext + causal freshness + DialogueAnchor/PendingClarification candidates`.

The next block remains offline. Response construction must consume grounded TaskState/NextStep only, enforce causal response freshness, and create anchor/clarification candidates that are not activated until publication commit.