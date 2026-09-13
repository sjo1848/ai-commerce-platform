# AI Commerce Platform — Agent Core State

Phase: `ACP-3.0 — COGNITIVE ARCHITECTURE REDESIGN / IMPLEMENTATION`
Task: `ACP-3.0.8 — IMPLEMENTATION FOUNDATION`
Status: `ACTIVE / IMPLEMENTATION`
Current sub-stage: `ACP-3.0.8.1 — TASKSTATE CONTRACTS + COMPATIBILITY PROJECTION`
Implementation: `UNBLOCKED BY DESIGN / NOT YET RUNTIME-WIRED`

## Current source identity

- Baseline: PR #63 `feature/r2.8.4-nlu-boundary-rework` exact head `10c649507b524c44fc4ed4fd1d0dd1e63cd13185`.
- Active implementation branch: `feature/acp-3.0.8-implementation-foundation`.
- Active contract: `.orchestration/contracts/ACP-3.0.8-IMPLEMENTATION-FOUNDATION.md`.
- Do not hardcode the moving execution HEAD here; resolve it from the branch/PR at gate time.

## Why the active path changed

R2.8.4 exposed a structural problem rather than a fixture-sized defect: language interpretation, durable conversation state, workflow planning and response wording were too coupled. The project therefore completed an ACP-3.0 design rework before resuming implementation.

PR #63 remains the historical implementation baseline and evidence source. Its provider-backed R2.8.4 gate is not retroactively declared closed; it is superseded as the active critical path by ACP-3.0 implementation.

## Closed ACP-3.0 design gates

- `ACP-3.0.1 Journey Specification` — PASS
- `ACP-3.0.2 Cognitive Contracts` — PASS / BASE
- `ACP-3.0.3 Task State Engine` — DESIGN PASS
- `ACP-3.0.4 Deterministic Planner` — DESIGN PASS
- `ACP-3.0.5 Semantic Interpreter` — DESIGN PASS
- `ACP-3.0.6 Cognitive E2E Integration` — DESIGN PASS
- `ACP-3.0.7 Response Composer` — DESIGN PASS
- `ARCHITECTURE_INTEGRATION_REVIEW` — PASS
- `READY_FOR_IMPLEMENTATION` — PASS

The detailed design artifacts and integration review are backed up in the project's Google Drive. The repository implementation contract is the current execution authority for ACP-3.0.8.

## Governing architecture

`User -> Interpreter -> validation -> Reducer -> TaskState -> PlanningTrigger -> deterministic Planner -> NextStep -> Core/Policy -> Tool -> Observation Mapper -> Reducer -> Planner -> ResponseContextBuilder -> Renderer -> publication -> DialogueAnchor`

Critical rules:
- LLM interprets user semantics; it never creates operational truth.
- State remembers durable task facts; ephemeral directives do not bloat durable state.
- Planner is deterministic and emits exactly one bounded NextStep.
- Core/Policy/Executor retain approval, authorization, exact operation binding and side-effect idempotency authority.
- Tool payloads are normalized by an Observation Mapper before entering TaskState.
- Staleness is causal through dependency fingerprints, not any unrelated global revision change.
- Approval resumes the exact PreparedOperation after revalidation; it does not ask Planner to infer the mutation again.
- Operational responses are deterministic/bounded; response facts and workflow are not LLM-authored.
- DialogueAnchor/PendingClarification activate only after the corresponding response is actually published.

## ACP-3.0.8.1 current work

Implemented on the active branch:
- `src/core/task-state.ts` — ACP-3.0 TaskState/authority foundation types;
- `src/core/task-state-adapter.ts` — read-only compatibility projection from existing ConversationState;
- `test/task-state-adapter-acp3.test.mjs` — migration/authority/scope tests;
- root exports for the new foundation.

Migration safety decision:
- only user/legacy-owned requested semantics are promoted into the new requested namespace;
- existing availability, selected rooms and booking fields are retained only as migration candidates because the legacy state lacks the complete ACP-3.0 dependency receipts;
- no new store or parallel production truth has been introduced;
- runtime routing behavior is not wired to ACP-3.0 yet.

Local isolated verification performed without remote resources:
- strict TypeScript contract check with `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`: PASS;
- adapter behavioral checks: `3/3 PASS`.

This is not repository-wide QA yet.

## Next gate

Before declaring `FOUNDATION_CONTRACTS_PASS`:
1. run repository typecheck/targeted test/QA on the exact branch head;
2. repair any compile or cross-repo regression;
3. record evidence;
4. then advance to `ACP-3.0.8.2 — DETERMINISTIC REDUCER`.

## Resource/safety boundary

No Worker deployment, provider inference, HMS mutation, approval consumption, production action, payment action or second vertical is authorized by this checkpoint.

GitHub Actions/provider cycles remain protected resources. Do not spend a remote cycle on documentation polish or redundant evidence.
