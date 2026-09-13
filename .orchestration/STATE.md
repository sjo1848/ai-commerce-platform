# AI Commerce Platform — Agent Core State

Phase: `ACP-3.0 — COGNITIVE ARCHITECTURE REDESIGN / IMPLEMENTATION`
Task: `ACP-3.0.8 — IMPLEMENTATION FOUNDATION`
Status: `ACTIVE / IMPLEMENTATION`
Current sub-stage: `ACP-3.0.8.2 — DETERMINISTIC REDUCER`
Last closed sub-stage: `ACP-3.0.8.1 — TASKSTATE CONTRACTS + COMPATIBILITY PROJECTION — FOUNDATION_CONTRACTS_PASS`

## Current source identity

- Baseline: PR #63 `feature/r2.8.4-nlu-boundary-rework` exact head `10c649507b524c44fc4ed4fd1d0dd1e63cd13185`.
- Active implementation branch: `feature/acp-3.0.8-implementation-foundation`.
- Active contract: `.orchestration/contracts/ACP-3.0.8-IMPLEMENTATION-FOUNDATION.md`.
- Do not hardcode the moving execution HEAD here; resolve it at gate time.

## ACP-3.0 design authority

Closed design gates:
- Journey Specification — PASS
- Cognitive Contracts — PASS / BASE
- Task State Engine — DESIGN PASS
- Deterministic Planner — DESIGN PASS
- Semantic Interpreter — DESIGN PASS
- Cognitive E2E Integration — DESIGN PASS
- Response Composer — DESIGN PASS
- Architecture Integration Review — PASS
- READY_FOR_IMPLEMENTATION — PASS

Governing pipeline:

`User -> Interpreter -> validation -> Reducer -> TaskState -> PlanningTrigger -> deterministic Planner -> NextStep -> Core/Policy -> Tool -> Observation Mapper -> Reducer -> Planner -> ResponseContextBuilder -> Renderer -> publication -> DialogueAnchor`

## 3.0.8.1 closure

`FOUNDATION_CONTRACTS_PASS` on exact head `31d91df9c1b211263245e43860077ca8f36d7aa3`.

Evidence:
- `core-ci` run `34754506869` / #639 — PASS;
- repository typecheck + tests — PASS;
- staging E2E runner syntax — PASS;
- Wrangler config validation — PASS;
- `.orchestration/evidence/ACP-3.0.8.1-FOUNDATION-CONTRACTS.md`.

Closed migration decision:
- only user/legacy-owned requested semantics are projected as requested truth;
- legacy availability/selection/booking remain migration candidates until ACP-3.0 dependency receipts exist;
- no parallel durable production store was introduced;
- runtime behavior remained unwired.

## 3.0.8.2 active scope

Implement deterministic `TaskState + TaskEvent -> ReductionResult` with:
- typed authority events;
- explicit `set | clear | noChange` semantics;
- causal invalidation through declared dependency keys/fingerprints;
- stale tool result rejection;
- exact server-side grounding boundary;
- bounded recent-event replay protection;
- no language parsing, tool choice, policy, execution or prose.

Current reducer candidate is locally validated in isolation with 7/7 focused cases PASS before repository CI.

## Preserved authority

- LLM interprets user semantics only; it never creates operational truth.
- Planner will be deterministic and bounded.
- PolicyEngine/AgentCoreExecutor retain authorization, HITL exact binding and side-effect idempotency.
- Tool payloads must pass Observation Mapper before TaskState.
- Staleness is causal, not global stateRevision invalidation.
- Approval resumes exact PreparedOperation after revalidation.

## Resource/safety boundary

No provider inference, Worker deployment, HMS mutation, approval consumption, production action, payment action or second vertical is authorized in 3.0.8.2.

Batch repo writes per logical block; avoid CI on intermediate commits.
