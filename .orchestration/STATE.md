# AI Commerce Platform — Agent Core State

Phase: `ACP-3.0 — COGNITIVE ARCHITECTURE REDESIGN / IMPLEMENTATION`
Task: `ACP-3.0.8 — IMPLEMENTATION FOUNDATION`
Status: `ACTIVE / IMPLEMENTATION`
Current sub-stage: `ACP-3.0.8.3 — HOTEL TASK DEFINITION + DETERMINISTIC PLANNER — FINAL CANDIDATE / CI PENDING`
Last closed sub-stage: `ACP-3.0.8.2 — DETERMINISTIC_REDUCER_PASS`

Baseline: PR #63 exact head `10c649507b524c44fc4ed4fd1d0dd1e63cd13185`.
Active branch: `feature/acp-3.0.8-implementation-foundation`.
Active contract: `.orchestration/contracts/ACP-3.0.8-IMPLEMENTATION-FOUNDATION.md`.

All ACP-3.0 design gates through `READY_FOR_IMPLEMENTATION` are PASS.

## Closed implementation evidence

- 3.0.8.1 `FOUNDATION_CONTRACTS_PASS`: head `31d91df9c1b211263245e43860077ca8f36d7aa3`, core-ci #639 / `34754506869` PASS.
- 3.0.8.2 `DETERMINISTIC_REDUCER_PASS`: head `5860202068eb89cce8f7b0e37d5e5dbc4225e987`, core-ci #643 / `34755757781` PASS.

Reducer final gate preserves optimistic user/server revision guards, causal tool-observation freshness, exact PreparedOperation/approval/execution binding, bounded replay protection and fail-closed state-machine races.

## 3.0.8.3 final candidate

Implemented locally before push:
- typed `HotelTaskDefinition` v1 with explicit real HMS capability bindings;
- server-built `DomainCapabilities` from visible tools;
- explicit capability requirements and dependency keys;
- shared deterministic precondition fingerprint contract;
- structured `PlanningTrigger` envelope;
- bounded exactly-one `NextStep` vocabulary;
- pure `HotelTaskPlanner`;
- native multi-room capability use without decomposition into multiple writes;
- read requests remain serviceable while approval is pending;
- no automatic retry after tool failure;
- no implicit knowledge/RAG capability;
- J01 synthetic traversal from missing facts through availability, grounding, reserve proposal, approval wait and grounded completion.

Adversarial correction before push: reservation preconditions explicitly include `operationIntent`, preventing a write proposal from surviving withdrawal/change of commit semantics when room/date facts remain unchanged.

Cancellation/modification remain fail-closed with `BOOKING_TARGET_GROUNDING_REQUIRED`: current TaskState has user `bookingReference` plus tool `bookings[]`, but no server-owned `groundedBookingTarget`. The Planner is forbidden from resolving that reference itself. This is a carry-forward state/reducer boundary requirement, not capability hallucination.

Focused isolated verification: planner 27/27 PASS under strict TypeScript.

Evidence: `.orchestration/evidence/ACP-3.0.8.3-DETERMINISTIC-PLANNER.md`.

`DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS` is pending exact-head repository CI and final review only.

## Authority boundaries

Planner does not receive raw text, normalize language/dates, create operational truth, ground user references, authorize/approve actions, execute tools, rank tools dynamically or generate user prose. Core/Policy/Executor remain authoritative for authorization, HITL exact binding and side-effect idempotency.

## Resource/safety boundary

No provider inference, Worker deployment, HMS mutation, approval consumption, production action, payment action or second vertical is authorized in 3.0.8.3.

Batch repository writes per logical block; avoid CI on intermediate commits.
