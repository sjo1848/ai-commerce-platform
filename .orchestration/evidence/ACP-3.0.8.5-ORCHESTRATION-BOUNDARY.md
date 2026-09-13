# ACP-3.0.8.5 — Interpreter/Reducer/Planner Orchestration Boundary Evidence

Status: `ORCHESTRATION_BOUNDARY_PASS`

## Exact gate

- exact head: `1694b0df4aacb1771a9143a73fcba92704a4bd50`
- core-ci #649 / `34764771302`: PASS
- typecheck/tests: PASS
- staging E2E runner syntax: PASS
- Cloudflare Worker config validation: PASS

The earlier intermediate head `9e988094c107e593188067fed5790a2b6a85fb51` is non-gate and is not used as acceptance evidence.

## Accepted user-turn order

The offline boundary enforces:
`validated InterpreterOutput -> UserSemanticEvent -> Reducer -> optional server-owned selection grounding -> normalized PlanningTrigger -> deterministic Planner`.

No Planner invocation occurs before accepted semantic changes are reduced.

## Closed findings

- Interpreter ambiguity remains ephemeral and produces bounded ASK behavior rather than durable operational truth.
- `unknown` user turns cannot fall through into an existing reserve/cancel/modify progression.
- abort-current-operation is distinct from cancelling a booking and clears mutation intent before planning only when execution has not already been admitted.
- abort after execution admission does not claim rollback.
- room-number/ordinal/ordinal-set/bounded relation references are grounded server-side against current authoritative availability and, where present, DialogueAnchor presentation semantics.
- anchor entities without enough semantic identity cannot fall back to hidden HMS ordering.
- descriptive room references remain ungrounded rather than creating room IDs by inference.
- contradictory selection reference and reserve-target semantics fail closed.
- compare-price and booking-lookup do not create hidden multi-call workflows when no declared capability exists.
- current-operation write retry remains control-plane owned.
- social/help/ack while approval is pending cannot advance the write.
- internal semantic reduction / grounding / planning work is bounded by `maxInternalSteps=3`.
- canonical J01 is represented offline through missing facts, availability proposal/observation, semantic ordinal, server grounding and reserve proposal.

## Scope boundary

This PASS closes only the Interpreter/Reducer/Planner user-turn boundary inside ACP-3.0.8.5. It does not complete orchestration integration and does not authorize runtime cutover.

Carry-forward work:
- admit Planner CALL_TOOL proposals through Core/Policy contracts;
- revalidate Planner precondition fingerprints immediately before write preparation/execution;
- preserve exact PreparedOperation/HITL binding;
- normalize tool/control outcomes into TaskEvents, reduce and replan;
- complete Observation Mapper and response boundary in later substages.

No real provider call, Worker deployment, HMS mutation, approval consumption, production action or payment occurred.
