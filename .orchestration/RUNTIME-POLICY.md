# Runtime Policy — Project Method Adapter

Status: ACTIVE project-level harness policy.

Purpose: make Project Method portable into Codex or another runtime without relying on chat memory. This file does not replace Project Method; it encodes the project-local runtime adapter and harness behavior.

## Method / Harness / Runtime / Model boundary

- **Project Method** defines phases, authority, decision boundaries, Human Gates, Critic semantics, REWORK, evidence obligations and reusable quality rules.
- **Project Harness** makes those rules executable/verifiable in this repository through canonical state, Task Contracts, invariants, tests, CI/staging, evidence and recovery.
- **Runtime Adapter** is Codex/OpenCode/Hermes/etc. It implements delegation/context/tool mechanics.
- **Model** provides reasoning/generation inside the runtime. Model choice does not redefine authority or gate semantics.

Traceability basis: Project Method v0.1, especially the portable-bootstrap, learned-invariant, Method-vs-Harness and context-recovery observations (PM-OBS-040 through PM-OBS-043), plus the validated multi-agent/rework rules already incorporated into the method.

## Fresh-context recovery preflight

Before substantive work:

1. Verify `pwd`, Git repository root, remote identity, branch, HEAD and working-tree status.
2. Read `AGENTS.md`.
3. Read `.orchestration/STATE.md` and `.orchestration/STATUS.json`.
4. Read `.orchestration/INVARIANTS.md`.
5. Identify the active Task Contract and required evidence/review artifacts.
6. Inspect current PR/review threads/CI for the active branch.
7. Reconcile stale or contradictory checkpoints against current immutable repository/PR/CI evidence; never infer silently.
8. Calculate the next authorized action. Do not require chat history to proceed.

If recovery cannot establish authority/state safely, classify the task BLOCKED and state the exact missing/contradictory source. Do not invent state.

## Multi-agent topology

Use the minimum number of contexts that create real value.

### Project Controller / Orchestrator

Owns:
- reading/reconciling canonical state;
- task sequencing and dependency handling;
- Task Contracts and decision latitude;
- Human Gate/Action/Input classification;
- source-of-truth convergence;
- dispatch to Specialists and Critics;
- root-cause escalation when rework patterns persist.

Must not:
- change product scope/strategy/material risk without a Human Gate;
- self-approve substantive work it produced;
- use the human as a routine message bus.

### Contextual Specialist

Ephemeral per task. Examples: Engineering, Root Cause/Architecture, QA/Security, Operations/Release, Product/UX.

Receives only the Task Contract, canonical inputs, constraints, decision latitude and required output/evidence.

Must not expand scope, change phase/mode or approve its own result.

### Independent Critic

Runs in a reasoning/context path independent from the substantive implementer whenever possible. Reviews the exact artifact and required evidence against contract, invariants and exit criteria.

Allowed verdicts follow the active harness semantics, normally PASS / REWORK / HUMAN_GATE (or CONTRACT_DEFECT/BLOCKED classification where the method requires diagnosis).

A Critic does not silently implement its own fixes.

### Integration Review

Required when independently produced branches/artifacts must compose. Branch PASS does not equal integrated PASS.

## Rework and root-cause escalation

Normal bounded loop:

`READY -> RUNNING -> CRITIC_REVIEW -> PASS | REWORK | HUMAN_GATE/BLOCKED`

REWORK may continue automatically only while the objective/scope remain stable and the correction is inside the contract.

Repeated substantive failure is **not** permission for endless micro-fixes. The existing Project Method rule applies: once the bounded rework budget/pattern is exhausted, freeze same-contract retries and diagnose first.

Diagnosis classes include:
- CONTRACT_DEFECT;
- EXECUTION_DEFECT;
- CRITIC_DEFECT / reviewer overreach;
- missing/stale context or evidence;
- EXTERNAL_BLOCKER;
- DESIGN/ARCHITECTURE ROOT CAUSE;
- genuine STRATEGIC_AMBIGUITY/RISK -> HUMAN_GATE.

For recurring findings in the same module/responsibility/abstraction, prefer Root-Cause / Architecture Review and simplification before another local patch. New special cases must not accumulate into a second hidden implementation of a responsibility owned elsewhere.

## Reasoning / model policy

Model identity is runtime-specific. Use the strongest currently available Codex-capable model appropriate to the task, but keep **reasoning effort adaptive**:

- **LOW:** routine implementation, mechanical repairs, simple test/CI/tooling work.
- **MEDIUM:** root-cause analysis, architecture, independent criticism, cross-cutting integration, difficult debugging.
- **HIGH:** security-critical, high-impact concurrency/data-integrity, or unusually difficult cross-cutting review where MEDIUM evidence is insufficient.

Do not escalate reasoning solely because a mechanical CI/test/tool invocation failed. Escalate based on substantive complexity, repeated defects or risk.

Prefer separate contexts over simply increasing reasoning when independence is the missing control.

## Evidence / harness policy

For substantive code changes, follow the active Task Contract and stage-specific gates. As applicable this includes:

- freeze regression/invariant before the production fix;
- minimal bounded implementation;
- exact artifact/HEAD verification;
- relevant unit/integration/e2e tests and CI;
- real staging/eval when contractually required;
- evidence linked to exact artifact/version;
- independent Critic;
- source-of-truth convergence before global closure.

Reruns must not hide functional RED. Retries are valid for transient/infrastructure diagnosis or an explicitly required stability sample on the same artifact.

## Human interaction policy

Human Gates are for strategy, scope, material risk/cost, irreversible choices and explicit product/release acceptance.

Do not stop for routine permission once a branch is already authorized. Do not ask the human to transport prompts/results between runtime contexts when the runtime can orchestrate them itself.

A Human Action caused by unavailable tools/capabilities must be prepared completely: exact action, channel/tool, inputs, expected evidence, success criterion and automatic resume condition.

## HMS / ACP safety invariant

Natural-language interpretation may propose structured intent/references, but server/core authority must validate/ground policy-critical state. Ambiguous or incomplete interpretation must never authorize a partial or unintended write.

Provider/model failure must not cause a deterministic fallback to invent semantic authority for a mutation. Preserve fail-closed behavior, exact HITL-plan binding, server-owned identity/room/date grounding, ownership, idempotency and zero unauthorized mutation.

## Maintenance rule

Keep `AGENTS.md` short and stable. Put detailed runtime policy here and current project state in STATE/STATUS/contracts/evidence. If a new runtime needs conversational history to reconstruct critical workflow semantics, treat that as a harness portability defect and repair durable bootstrap/state instead of teaching the human a longer prompt.
