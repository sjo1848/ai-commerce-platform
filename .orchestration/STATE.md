# AI Commerce Platform — Agent Core State

Phase: `ACP-3.0 — COGNITIVE ARCHITECTURE REDESIGN / IMPLEMENTATION`
Task: `ACP-3.0.8 — IMPLEMENTATION FOUNDATION`
Status: `ACTIVE / IMPLEMENTATION`
Current sub-stage: `ACP-3.0.8.6.B — RESPONSE CONTEXT + FRESHNESS + PUBLICATION CANDIDATES`
Last closed sub-stage: `ACP-3.0.8.6.A — OBSERVATION_MAPPER_REPLAN_PASS`

Baseline: PR #63 exact head `10c649507b524c44fc4ed4fd1d0dd1e63cd13185`.
Active branch: `feature/acp-3.0.8-implementation-foundation`.

## Closed implementation gates

- 3.0.8.1 `FOUNDATION_CONTRACTS_PASS`: `31d91df9c1b211263245e43860077ca8f36d7aa3`, core-ci #639 / `34754506869` PASS.
- 3.0.8.2 `DETERMINISTIC_REDUCER_PASS`: `5860202068eb89cce8f7b0e37d5e5dbc4225e987`, core-ci #643 / `34755757781` PASS.
- 3.0.8.3 `DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS`: `a8c91bd67fbcb1125a8f9f5daa4c97e6c6ce5102`, core-ci #646 / `34762367166` PASS.
- 3.0.8.4 `SEMANTIC_INTERPRETER_ADAPTER_PASS`: `6ecb687f1912003c86f772420759e6d25bce720f`, core-ci #647 / `34762941975` PASS.
- 3.0.8.5 sub-gate `ORCHESTRATION_BOUNDARY_PASS`: `1694b0df4aacb1771a9143a73fcba92704a4bd50`, core-ci #649 / `34764771302` PASS.
- 3.0.8.5 `ORCHESTRATION_INTEGRATION_PASS`: `b6020d62b36481ae4efaa7f0db313997c6e31a0d`, core-ci #652 / `34769395411` PASS.
- 3.0.8.6.A `OBSERVATION_MAPPER_REPLAN_PASS`: `9abbf75390d568765f293269569d645acdf36a29`, core-ci #654 / `34770532449` PASS, `488/488` tests.

## 3.0.8.6.A closure

The offline post-tool path is now proven through deterministic replanning:
`typed/raw tool outcome -> Observation Mapper -> TaskEvent -> Reducer -> TaskState -> Planner`.

The Observation Mapper is the only ACP-3 boundary allowed to inspect supported raw tool-result shapes. It validates invocation/operation correlation, admitted input bindings and supported HMS result contracts before producing TaskEvents. Planner never receives raw HMS payloads or raw exception prose.

Availability and quote results are causally bound to the exact pending invocation and dependency fingerprint. Late/superseded observations fail closed. Zero availability remains valid business truth. HMS availability also records the material limitation that guest-capacity filtering is not modeled when the service reports `capacityFilterApplied=false`, preventing downstream responses from claiming unsupported capacity truth.

Write outcomes bind to the exact executing operation. Composite multi-room create/cancel outcomes are reduced atomically, preserving all confirmed booking IDs and partial operational truth without prematurely confirming the whole operation from a single child result. Compensation failures and partial cancellations preserve known booking truth while marking execution failed.

Initial candidate `2190514e2170a1584d61f39a41a29e968804ebc7` / core-ci #653 failed `483/486`: the Mapper and Reducer were correct, but Planner priority returned `WAIT` from stale approved PreparedOperation before surfacing `execution.failed`. Rework `9abbf75390d568765f293269569d645acdf36a29` fixed that priority and added direct regressions while preserving explicit reads after a failed write. core-ci #654 passed `488/488`, staging runner syntax and Wrangler dry-run.

Evidence: `.orchestration/evidence/ACP-3.0.8.6A-OBSERVATION-MAPPER-REPLAN.md`.

## 3.0.8.6.B objective

Implement the server-owned response boundary:
`TaskState + NextStep -> ResponseContextBuilder -> ResponseContext -> deterministic/bounded Renderer -> final response admission -> publication candidate`.

Requirements:
- ResponseContext is deterministic and contains only user-visible grounded facts needed for the current NextStep;
- raw tool payloads and full TaskState must not enter the Renderer;
- presentation entity order is server-owned and stable;
- derived facts are server-calculated and explicit;
- question authority comes from Planner/Core only; Renderer cannot create extra workflow;
- response freshness is causal via `responseDependencyFingerprint`; `stateRevision` is metadata/concurrency guard, not global semantic freshness;
- final admission must detect the validate-then-state-changes-before-publication race;
- DialogueAnchorCandidate and PendingClarificationCandidate are built from NextStep/presentation/question semantics, never from generated text;
- candidates are not activated until publication is accepted/committed by the output boundary;
- stale/rejected responses leave no durable conversational anchor;
- no runtime cutover yet.

## Boundaries

No production cutover, real provider inference, Worker deployment, HMS mutation, approval consumption, payment action or second vertical is authorized.
