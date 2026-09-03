# AI Commerce Platform — Agent Bootstrap

This repository is governed by **Project Method + Project Harness**. A runtime/model executes the workflow; it does not redefine it.

## Start here — every fresh Codex/runtime context

Before substantive work, read and reconcile:

1. `.orchestration/STATE.md` — human-readable project state/checkpoint.
2. `.orchestration/STATUS.json` — machine-readable orchestration state.
3. `.orchestration/INVARIANTS.md` — learned project invariants.
4. The active file under `.orchestration/contracts/`.
5. Relevant `.orchestration/evidence/` and `.orchestration/reviews/`.
6. `.orchestration/RUNTIME-POLICY.md` — roles, multi-agent, reasoning and recovery policy.
7. Current Git branch/HEAD, PR, review threads and CI/evidence for the active task.

Conversation history is cache, not authority. If durable sources disagree, **do not guess**: reconcile them using current repository/PR/CI evidence and make divergence explicit.

## Authority

- **Human/Product Owner:** product, strategy, material risk/cost and explicit Human Gates.
- **Project Controller / Orchestrator:** scope-preserving sequencing, Task Contracts, gates, state and handoffs.
- **Specialist / Codex worker:** executes bounded work inside the active Task Contract.
- **Independent Critic:** independently reviews output/evidence; the implementer does not approve its own work.
- **Integration Review:** checks combined work when multiple branches/results must compose.
- **Harness:** tests, CI, staging, invariants, evidence and source-of-truth convergence.

## Operating rules

- Work in small, closable increments tied to explicit acceptance/evidence.
- Respect Allowed / Forbidden actions and Decision Latitude in the Task Contract.
- Do not expand scope or advance stage/gate on your own.
- Do not ask the human to relay routine prompts, handoffs or results between agents.
- After an authorized branch is clear, continue through routine work until a legitimate Human Gate, Human Action, material blocker or stop condition.
- Independent criticism is mandatory where required by the active contract/harness.
- A technical PASS never implies Product Acceptance or Production readiness.
- Repeated substantive REWORK is a diagnostic trigger: stop repeating the same fix pattern, classify the cause and reopen design/contract/root-cause review when appropriate.

## Current-project safety boundary

For HMS/ACP mutation paths, preserve server authority, exact HITL binding, idempotency, ownership and fail-closed behavior. Never consume approval or mutate HMS unless the active contract/stage explicitly authorizes it.

Do not store current stage numbers or transient SHAs in this file. Recover them from the durable state and current GitHub evidence above.
