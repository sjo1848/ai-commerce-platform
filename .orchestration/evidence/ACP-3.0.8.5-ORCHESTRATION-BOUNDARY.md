# ACP-3.0.8.5 — Interpreter/Reducer/Planner Orchestration Boundary Evidence

Status: `FINAL CANDIDATE / EXACT-HEAD CI PENDING`

## Prerequisite gates

- `DETERMINISTIC_REDUCER_PASS`: `5860202068eb89cce8f7b0e37d5e5dbc4225e987`, core-ci `34755757781` PASS.
- `DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS`: `a8c91bd67fbcb1125a8f9f5daa4c97e6c6ce5102`, core-ci `34762367166` PASS.
- `SEMANTIC_INTERPRETER_ADAPTER_PASS`: `6ecb687f1912003c86f772420759e6d25bce720f`, core-ci `34762941975` PASS.

## Implemented boundary

`applyInterpreterTurnToPlanner` is an offline deterministic slice. It does not call a provider or a tool. Its order is fixed:

1. receive already-validated `InterpreterOutput`;
2. normalize durable semantic changes into a `UserSemanticEvent`;
3. reduce them with optimistic revision guards;
4. perform bounded server-owned room-reference grounding when the current turn supplies a groundable semantic reference;
5. reduce `SelectionGroundedEvent` before planning;
6. normalize ephemeral directives into `OrchestrationPlanningTrigger`;
7. plan against the post-reducer/post-grounding TaskState.

This closes the cross-contract rule that planning must never happen before accepted user corrections are reduced.

## Authority and safety findings

- Interpreter ambiguity is not persisted as task truth. It becomes a bounded PlanningTrigger/ASK.
- `unknown` classification cannot fall through into an existing reserve/cancel/modify path.
- Abort is a workflow-control directive, not booking cancellation. Before execution admission it deterministically clears operation intent, allowing Reducer dependency invalidation to invalidate a PreparedOperation before Planner acknowledges the abort. After execution admission it is too late and no semantic rollback is fabricated.
- `current_operation` retry is not a Planner write retry and remains control-plane owned.
- `compare_price` and `booking_lookup` do not synthesize hidden tool loops. Without declared capabilities they degrade explicitly.
- Booking grounding remains outside Planner and is still carry-forward.

## Server-owned room grounding

The model never emits operational room IDs. The boundary can resolve:
- unique room number;
- ordinal / ordinal set;
- bounded `both` / `other` relation over exactly two grounded presented options.

When a DialogueAnchor exists, ordinal grounding follows that presentation. A presented entity without enough semantic identity to resolve back to authoritative availability is not allowed to fall back to hidden HMS order.

Descriptive references stay ambiguous until another declared grounding mechanism exists.

Selection and reserve-target semantics are checked for contradiction both within the current turn and against a persistent explicit target. The server refuses to silently write against a different room than the user committed to.

## Loop bound

`maxInternalSteps` defaults to 3: semantic reduction, optional grounding reduction, then planning. The boundary fails closed if the limit is exceeded.

## Candidate verification

Local verification completed without provider/network/tool side effects:
- strict TypeScript compile of the new boundary against typed contracts: PASS;
- Node syntax validation for the test modules: PASS;
- 19 focused runtime cases authored, including canonical J01, correction during pending availability, approval withdrawal + quote, abort before/after execution admission, unknown/social/ambiguity handling, semantic-reference conflicts, anchor-aware ordinal/relation grounding, unsupported compare/lookup reads, control-plane retry and max-step enforcement.

Behavioral execution against the real repository implementation is intentionally delegated to exact-head `core-ci`; it is not pre-claimed as PASS.

## Non-gate intermediate commit

`9e988094c107e593188067fed5790a2b6a85fb51` contains trigger normalization only. It was created as an intermediate branch write and is explicitly non-authoritative. Any workflow on that head does not count for this gate.

## Gate scope

A GREEN exact-head repository CI may close only the `ORCHESTRATION_BOUNDARY_PASS` sub-gate. It does **not** complete ACP-3.0.8.5 and does not authorize runtime cutover.

Next integration work after GREEN:
- translate Planner `CALL_TOOL` into Core/Policy proposal admission;
- preserve exact PreparedOperation/HITL binding;
- revalidate precondition fingerprints immediately before writes;
- normalize tool/control outcomes through Reducer and back to Planner;
- keep all work offline/non-mutating until those contracts are independently gated.

No real provider call, Worker deployment, HMS mutation, approval consumption, production action or payment occurred in this block.
