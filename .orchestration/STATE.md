# AI Commerce Platform — Agent Core State

Phase: `ACP-3.0 — COGNITIVE ARCHITECTURE REDESIGN / IMPLEMENTATION`
Task: `ACP-3.0.8 — IMPLEMENTATION FOUNDATION`
Status: `ACTIVE / IMPLEMENTATION`
Current sub-stage: `ACP-3.0.8.5 — ORCHESTRATION INTEGRATION — INTERPRETER/REDUCER/PLANNER BOUNDARY FINAL CANDIDATE / CI PENDING`
Last closed sub-stage: `ACP-3.0.8.4 — SEMANTIC_INTERPRETER_ADAPTER_PASS`

Baseline: PR #63 exact head `10c649507b524c44fc4ed4fd1d0dd1e63cd13185`.
Active branch: `feature/acp-3.0.8-implementation-foundation`.

## Closed implementation gates

- 3.0.8.1 `FOUNDATION_CONTRACTS_PASS`: `31d91df9c1b211263245e43860077ca8f36d7aa3`, core-ci #639 / `34754506869` PASS.
- 3.0.8.2 `DETERMINISTIC_REDUCER_PASS`: `5860202068eb89cce8f7b0e37d5e5dbc4225e987`, core-ci #643 / `34755757781` PASS.
- 3.0.8.3 `DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS`: `a8c91bd67fbcb1125a8f9f5daa4c97e6c6ce5102`, core-ci #646 / `34762367166` PASS.
- 3.0.8.4 `SEMANTIC_INTERPRETER_ADAPTER_PASS`: `6ecb687f1912003c86f772420759e6d25bce720f`, core-ci #647 / `34762941975` PASS.

## 3.0.8.5 boundary candidate

The offline user-turn boundary now enforces the designed order:
`validated InterpreterOutput -> UserSemanticEvent -> Reducer -> optional server grounding -> normalized PlanningTrigger -> Planner`.

Candidate properties:
- ambiguity, retry, compare-price, booking-lookup, show-options, social/help and unknown-turn signals remain ephemeral trigger data;
- `unknown` turns cannot accidentally advance an already-active mutation;
- abort maps deterministically to an `operationIntent` clear before planning when execution has not been admitted, so dependent PreparedOperation state is invalidated by Reducer first;
- abort after execution admission does not synthesize a semantic clear and fails closed as too late;
- room references are grounded server-side only against authoritative availability and, when supplied, DialogueAnchor presentation semantics;
- ordinals with an anchor require a semantically resolvable presented entity and never fall back to hidden HMS ordering;
- conflicting durable selection and reserve-target semantics fail closed;
- descriptive room references remain ungrounded/ASK rather than becoming operational IDs by inference;
- compare-price and booking-lookup remain explicit unsupported reads until declared capabilities exist; no hidden N-call workflows are introduced;
- current-operation write retry remains control-plane owned;
- `maxInternalSteps` defaults to 3 and bounds semantic reduction, grounding reduction and planning.

J01 is represented by an offline contract test through missing facts -> availability proposal -> authoritative availability observation -> semantic ordinal -> server grounding -> reserve proposal. The candidate also carries correction, approval withdrawal, abort, ambiguity, relation grounding and stale-precondition cases.

Local pre-push verification: strict TypeScript boundary compile PASS; test syntax PASS; 19 targeted runtime cases authored. Repository execution is intentionally pending exact-head CI.

An intermediate commit `9e988094c107e593188067fed5790a2b6a85fb51` was created while adding trigger normalization. It is not a gate and its CI, if any, is non-authoritative. Only the final candidate exact head may close this boundary sub-gate.

## Carry-forward inside 3.0.8.5

This boundary does not yet cut over `ChatOrchestrator`, admit CALL_TOOL through Core/Policy/Executor, revalidate write preconditions immediately before execution, or normalize tool/control events back through the new Planner path. Those remain the next integration block after this boundary is GREEN.

Booking-reference grounding also remains fail-closed until a server-owned grounded booking target/lookup capability exists.

## Boundaries

No production cutover, real provider inference, Worker deployment, HMS mutation, approval consumption, payment action or second vertical is authorized.
