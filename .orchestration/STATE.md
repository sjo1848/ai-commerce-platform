# AI Commerce Platform — Agent Core State

Phase: `ACP-3.0 — COGNITIVE ARCHITECTURE REDESIGN / IMPLEMENTATION`
Task: `ACP-3.0.8 — IMPLEMENTATION FOUNDATION`
Status: `ACTIVE / IMPLEMENTATION`
Current sub-stage: `ACP-3.0.8.5 — CORE/POLICY PROPOSAL ADMISSION + PRECONDITION REVALIDATION`
Last closed sub-gate: `ACP-3.0.8.5 — ORCHESTRATION_BOUNDARY_PASS`

Baseline: PR #63 exact head `10c649507b524c44fc4ed4fd1d0dd1e63cd13185`.
Active branch: `feature/acp-3.0.8-implementation-foundation`.

## Closed implementation gates

- 3.0.8.1 `FOUNDATION_CONTRACTS_PASS`: `31d91df9c1b211263245e43860077ca8f36d7aa3`, core-ci #639 / `34754506869` PASS.
- 3.0.8.2 `DETERMINISTIC_REDUCER_PASS`: `5860202068eb89cce8f7b0e37d5e5dbc4225e987`, core-ci #643 / `34755757781` PASS.
- 3.0.8.3 `DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS`: `a8c91bd67fbcb1125a8f9f5daa4c97e6c6ce5102`, core-ci #646 / `34762367166` PASS.
- 3.0.8.4 `SEMANTIC_INTERPRETER_ADAPTER_PASS`: `6ecb687f1912003c86f772420759e6d25bce720f`, core-ci #647 / `34762941975` PASS.
- 3.0.8.5 sub-gate `ORCHESTRATION_BOUNDARY_PASS`: `1694b0df4aacb1771a9143a73fcba92704a4bd50`, core-ci #649 / `34764771302` PASS.

## Orchestration boundary closure

The offline user-turn path now enforces:
`validated InterpreterOutput -> UserSemanticEvent -> Reducer -> optional server-owned selection grounding -> normalized PlanningTrigger -> deterministic Planner`.

It preserves ephemeral ambiguity/read/retry/social signals outside durable state, blocks unknown turns from advancing existing mutations, keeps abort distinct from booking cancellation, grounds room references against authoritative availability/DialogueAnchor, rejects contradictory selection/operation-target semantics, and bounds internal work with `maxInternalSteps=3`.

The intermediate head `9e988094c107e593188067fed5790a2b6a85fb51` is explicitly non-gate even though its CI passed; only `1694b0df4aacb1771a9143a73fcba92704a4bd50` closes this sub-gate.

## Current objective inside 3.0.8.5

Continue offline integration from Planner `CALL_TOOL` into the existing Core/Policy/Executor contracts without executing real tools:
- admit a Planner proposal only if its capability binding and grounded input remain valid;
- revalidate `preconditionFingerprint` immediately before prepare/execute admission;
- preserve exact PreparedOperation / approval / operation fingerprint binding;
- map read/write control outcomes back to TaskEvent/Reducer instead of bypassing state;
- keep write retry control-plane owned;
- maintain a finite internal loop.

Runtime cutover remains blocked until this path is independently gated.

## Boundaries

No production cutover, real provider inference, Worker deployment, HMS mutation, approval consumption, payment action or second vertical is authorized.
