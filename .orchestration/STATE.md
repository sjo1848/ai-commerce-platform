# AI Commerce Platform — Agent Core State

Phase: `ACP-3.0 — COGNITIVE ARCHITECTURE REDESIGN / IMPLEMENTATION`
Task: `ACP-3.0.8 — IMPLEMENTATION FOUNDATION`
Status: `ACTIVE / IMPLEMENTATION`
Current sub-stage: `ACP-3.0.8.6 — OBSERVATION MAPPER + RESPONSE BOUNDARY`
Last closed sub-stage: `ACP-3.0.8.5 — ORCHESTRATION_INTEGRATION_PASS`

Baseline: PR #63 exact head `10c649507b524c44fc4ed4fd1d0dd1e63cd13185`.
Active branch: `feature/acp-3.0.8-implementation-foundation`.

## Closed implementation gates

- 3.0.8.1 `FOUNDATION_CONTRACTS_PASS`: `31d91df9c1b211263245e43860077ca8f36d7aa3`, core-ci #639 / `34754506869` PASS.
- 3.0.8.2 `DETERMINISTIC_REDUCER_PASS`: `5860202068eb89cce8f7b0e37d5e5dbc4225e987`, core-ci #643 / `34755757781` PASS.
- 3.0.8.3 `DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS`: `a8c91bd67fbcb1125a8f9f5daa4c97e6c6ce5102`, core-ci #646 / `34762367166` PASS.
- 3.0.8.4 `SEMANTIC_INTERPRETER_ADAPTER_PASS`: `6ecb687f1912003c86f772420759e6d25bce720f`, core-ci #647 / `34762941975` PASS.
- 3.0.8.5 sub-gate `ORCHESTRATION_BOUNDARY_PASS`: `1694b0df4aacb1771a9143a73fcba92704a4bd50`, core-ci #649 / `34764771302` PASS.
- 3.0.8.5 `ORCHESTRATION_INTEGRATION_PASS`: `b6020d62b36481ae4efaa7f0db313997c6e31a0d`, core-ci #652 / `34769395411` PASS.

## 3.0.8.5 closure

The offline cognitive path is now proven through Core/Policy admission:
`validated InterpreterOutput -> UserSemanticEvent -> Reducer -> optional server-owned selection grounding -> PlanningTrigger -> deterministic Planner -> CALL_TOOL admission -> Policy -> reducer control event`.

The Planner proposal is revalidated against current TaskState before admission. Grounded input tampering and stale preconditions fail closed. Real tool validators canonicalize trusted server-owned input before operation fingerprinting. Prepared writes persist the exact `capabilityId` and `toolId`, so approval resume never re-infers a tool from generic operation type. Execution admission revalidates capability binding, dependency fingerprint, canonical input, operation fingerprint and current Policy before emitting `ExecutionStartedEvent` and an exact executor request.

No tool execution occurs inside the new admission boundary. The final cross-boundary proof covers both availability-read admission and approval-bound reservation preparation with zero HMS executions.

Candidate history is retained in evidence: core-ci #650 failed on two TypeScript narrowing errors only; the corrected #651 passed 473/473 tests, and final integration #652 passed 475/475 tests plus staging runner syntax and Wrangler dry-run.

## 3.0.8.6 objective

Implement the next offline boundary:
`raw/typed tool result -> Observation Mapper -> TaskEvent -> Reducer -> TaskState -> Planner -> response boundary`.

Requirements:
- raw HMS/tool payload must never reach the Planner;
- Observation Mapper validates and normalizes only supported result shapes;
- malformed or mismatched results fail closed as structured failure/degradation;
- availability/quote/business-write observations bind to the exact invocation/operation fingerprints already in state;
- late/stale observations cannot become current operational truth;
- response construction consumes grounded TaskState/NextStep context, not raw provider/tool prose;
- no runtime cutover yet.

## Boundaries

No production cutover, real provider inference, Worker deployment, HMS mutation, approval consumption, payment action or second vertical is authorized.
