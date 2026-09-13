# ACP-3.0.8 — Implementation Foundation

Status: `ACTIVE`
Mode: `IMPLEMENTATION`
Base: PR #63 head `10c649507b524c44fc4ed4fd1d0dd1e63cd13185`
Branch: `feature/acp-3.0.8-implementation-foundation`

## Purpose

Translate the approved ACP-3.0 cognitive architecture into incremental code without a big-bang rewrite and without weakening the existing Core/Policy/Executor/HITL/idempotency boundaries.

The approved design sequence is:

`Interpreter -> validation -> reducer -> TaskState -> PlanningTrigger -> deterministic Planner -> Core/Policy -> Tool -> Observation Mapper -> reducer -> Planner -> ResponseContextBuilder -> Renderer -> publication -> DialogueAnchor`

Architecture gate before this contract: `READY_FOR_IMPLEMENTATION = PASS`.

## Baseline rule

PR #63 is preserved as the historical implementation baseline. ACP-3.0 work branches from its exact head and does not rewrite or silently merge `main` state.

The existing `ConversationState` is an asset to migrate from, not a second durable truth to run in parallel indefinitely.

## Increment sequence

### 3.0.8.1 — TaskState contracts + compatibility projection

Implement:
- typed ACP-3.0 TaskState authority namespaces;
- explicit `set | clear`, with omission meaning `noChange`;
- causal dependency / operation fingerprint types;
- read-only projection from current `ConversationState`;
- preserve only user/legacy-owned requested semantics as requested truth;
- keep old availability, selection and booking fields as migration candidates until they can be revalidated under ACP-3.0 dependency receipts;
- tests proving scope isolation and no authority promotion.

No runtime routing behavior changes in this increment.

### 3.0.8.2 — Deterministic reducer

Implement TaskState + typed TaskEvent -> ReductionResult, causal invalidation and replay/concurrency guards independently of language models.

### 3.0.8.3 — Hotel TaskDefinition + deterministic Planner

Implement bounded PlanningContext / PlanningTrigger / NextStep and synthetic J01 traversal without an LLM.

### 3.0.8.4 — Semantic Interpreter adapter

Adapt the current model boundary to the approved InterpreterOutput contract. No workflow planning or operational truth from the model.

### 3.0.8.5 — Orchestration integration

Wire `validate -> reduce -> normalize trigger -> plan` while preserving existing Core/Policy/Executor.

### 3.0.8.6 — Observation Mapper + response boundary

Add validated observations, deterministic ResponseContextBuilder, bounded renderer, publication admission and post-publication DialogueAnchor/PendingClarification activation.

### 3.0.8.7 — J01 implementation gate

Run component/integration tests, then the provider-backed real J01 only after the local path is green.

## Allowed

- add ACP-3.0 contract/types/reducer/planner/interpreter adapter modules;
- add local deterministic tests;
- add compatibility adapters around existing state;
- refactor orchestration incrementally after the preceding contracts are green;
- reuse existing tool contracts, HMS adapters, policy, HITL, idempotency, ownership and audit boundaries.

## Forbidden

- production cutover;
- real customer data;
- payment mutation;
- autonomous writes outside existing policy/HITL;
- rewriting PolicyEngine or AgentCoreExecutor without a separate finding/gate;
- event-sourcing rewrite;
- universal workflow DSL;
- dynamic tool ranking;
- second deterministic NLU/regex language engine;
- RAG as workflow control;
- second vertical implementation;
- provider/deployment traffic before the local deterministic path warrants it.

## 3.0.8.1 acceptance

`FOUNDATION_CONTRACTS_PASS` requires:
- TaskState v1 types compile under repository strict TypeScript settings;
- requested semantics are separated from operational observations;
- `ConversationState` projection is read-only;
- tool/server-derived stay values are not reclassified as user requests;
- legacy availability/selection/booking are not silently promoted without dependency receipts;
- tenant/actor/session scope mismatch fails closed;
- existing runtime behavior remains unwired/unchanged;
- targeted tests pass;
- repository typecheck/QA must pass before integration.

## 3.0.8.3 acceptance

`DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS` requires:
- TaskDefinition declares deterministic bindings, requirements and complete dependency keys for implemented capabilities;
- DomainCapabilities only exposes real visible domain capabilities and does not replace Policy;
- PlanningTrigger carries no raw text;
- exactly one bounded NextStep is emitted;
- every CALL_TOOL has grounded input + deterministic precondition fingerprint;
- write preconditions include current operation/commit semantics;
- matching pending reads are not duplicated;
- zero-result, failure and pending remain distinct;
- no automatic retry;
- no dynamic tool ranking or multi-write decomposition;
- approval/execution remain outside Planner authority;
- J01 is traversable synthetically without LLM planning;
- missing booking-target grounding fails closed rather than moving reference resolution into Planner;
- focused tests and exact-head repository CI pass.

## Evidence discipline

GitHub Actions and provider calls are protected resources. Prefer local/static verification during implementation. A remote cycle is justified only when it directly reduces a material integration blocker or supplies a required gate.

Technical PASS does not imply product acceptance or ACP-3.0 completion.
