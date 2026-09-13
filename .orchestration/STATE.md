# AI Commerce Platform — Agent Core State

Phase: `ACP-3.0 — COGNITIVE ARCHITECTURE REDESIGN / IMPLEMENTATION`
Task: `ACP-3.0.8 — IMPLEMENTATION FOUNDATION`
Status: `ACTIVE / IMPLEMENTATION`
Current sub-stage: `ACP-3.0.8.2 — DETERMINISTIC REDUCER — REVIEW 01 AMENDED / CI PENDING`
Last closed sub-stage: `ACP-3.0.8.1 — TASKSTATE CONTRACTS + COMPATIBILITY PROJECTION — FOUNDATION_CONTRACTS_PASS`

## Current source identity

- Baseline: PR #63 `feature/r2.8.4-nlu-boundary-rework` exact head `10c649507b524c44fc4ed4fd1d0dd1e63cd13185`.
- Active implementation branch: `feature/acp-3.0.8-implementation-foundation`.
- Active contract: `.orchestration/contracts/ACP-3.0.8-IMPLEMENTATION-FOUNDATION.md`.
- Resolve the moving execution HEAD at gate time.

## Closed design authority

Journey Specification, Cognitive Contracts, Task State Engine, Deterministic Planner, Semantic Interpreter, Cognitive E2E Integration, Response Composer and Architecture Integration Review are all DESIGN PASS; `READY_FOR_IMPLEMENTATION = PASS`.

Governing pipeline:
`User -> Interpreter -> validation -> Reducer -> TaskState -> PlanningTrigger -> deterministic Planner -> NextStep -> Core/Policy -> Tool -> Observation Mapper -> Reducer -> Planner -> ResponseContextBuilder -> Renderer -> publication -> DialogueAnchor`.

## 3.0.8.1 closure

`FOUNDATION_CONTRACTS_PASS` on exact head `31d91df9c1b211263245e43860077ca8f36d7aa3`.

Evidence: `core-ci` run `34754506869` / #639 PASS and `.orchestration/evidence/ACP-3.0.8.1-FOUNDATION-CONTRACTS.md`.

## 3.0.8.2 Review 01

Initial reducer candidate `d9466599dbaa6af75f986f2faf6d743562ad2627` passed `core-ci` run `34754777914` / #640, but CI alone did not close the design/implementation gate.

Adversarial review found and amended:
1. optimistic revision guard for user/server events while keeping tool observations dependency-based;
2. terminal tasks fail closed and terminal transitions supersede pending work / invalidate prepared operations;
3. a new availability observation invalidates grounding and prepared operations that depended on the replaced availability.

Focused pre-push verification after amendments:
- reducer: 11/11 PASS;
- compatibility projection: 4/4 PASS;
- combined strict isolated verification: 15/15 PASS.

Evidence: `.orchestration/evidence/ACP-3.0.8.2-DETERMINISTIC-REDUCER.md`.

`DETERMINISTIC_REDUCER_PASS` remains pending exact-head repository CI.

## Preserved authority

- LLM interprets user semantics only; it never creates operational truth.
- Reducer does not parse language, choose tools, decide policy, execute side effects or generate prose.
- PolicyEngine/AgentCoreExecutor retain authorization, HITL exact binding and side-effect idempotency.
- Tool observations use invocation/dependency receipts; unrelated stateRevision changes do not stale them.
- Server/user mutations use optimistic revision guards.
- Approval resumes exact PreparedOperation after revalidation.

## Resource/safety boundary

No provider inference, Worker deployment, HMS mutation, approval consumption, production action, payment action or second vertical is authorized in 3.0.8.2.

Batch repository writes per logical block; avoid CI on intermediate commits.
