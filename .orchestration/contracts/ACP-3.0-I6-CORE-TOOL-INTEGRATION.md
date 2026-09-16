# ACP-3.0 I6 — Core / Tool Integration

Status: `I6_CORE_TOOL_INTEGRATION_PASS = PASS`
Block: `I6 = CLOSED`, conditional on exact-head closure CI for this documentation commit
Date: `2026-09-16`

## Authority

- Base: `35da4f0ab59d0989665829fbee199ea44d122cbd` — authoritative I5 closure.
- Substantive I6 head: `203b8c4f2b75b92486687c3e8fe2f484c198e9ab`.
- Exact substantive validation: `core-ci #766 = PASS` on that exact SHA.
- This gate authorizes I7 Observation Mapper only. It does not authorize production runtime cutover, deployment, provider-backed J01, real HMS writes, or consumption of real approvals.

## Implemented boundary

```text
Deterministic Planner CALL_TOOL
→ independent causal precondition revalidation
→ side-effect-free Core admission
   (ToolRegistry + PolicyEngine + validateInput + operationFingerprint)
→ read: PendingToolInvocation + bounded lease + Core execute
→ write: exact PreparedOperation + HITL gate + Core execute/idempotency
→ raw tool result/error returned outside TaskState
→ I7 Observation Mapper [next block]
```

For write approval recovery:

```text
approved PreparedOperation
→ exact capabilityId + capabilityContractIdentity check
→ current causal fingerprint revalidation
→ Core admission/canonical-input fingerprint check
→ AgentCoreExecutor with same operationId idempotency key
→ no Planner reroute
```

For control/recovery failure:

```text
Core admission/recovery failure
→ typed ServerControlEvent.tool_control_failure
→ Reducer causal admission (no business-state mutation)
→ PLANNING_TRIGGER
→ hotel-task-planner-entry
→ bounded DEGRADE
→ no automatic tool retry
```

## Locked invariants

1. `AgentCoreExecutor` remains authoritative for actual execution, policy enforcement at execution time, idempotency, audit and tool invocation.
2. `CoreToolAdmission` is side-effect-free. It reuses the authoritative ToolRegistry, PolicyEngine, tool `validateInput`, canonicalization and operation fingerprint implementation; it never executes a tool and never consumes approval.
3. I6 does not introduce a second Policy engine, tool registry, executor or deterministic NLU layer.
4. Every Planner `CALL_TOOL` is causally revalidated independently against current TaskState before admission or dispatch.
5. Revalidation recomputes the same contract-bound dependency fingerprint from current authoritative dependencies; a stale/tampered input or fingerprint fails closed.
6. Read calls are represented by one `PendingToolInvocation` with exact capability, canonical input snapshot, dependency fingerprint, dependency paths and bounded lease.
7. Read redispatch is allowed only for side-effect-free read capabilities, only while the same invocation remains causally current and its lease remains active.
8. Lease expiry, precondition supersession, admission failure, policy denial or effect drift terminalizes recovery before a bounded planning control is emitted.
9. Raw tool/HMS results do not become TaskState truth in I6. I7 owns Observation Mapper and the ToolObservationEvent transition.
10. Raw execution exceptions do not directly mutate TaskState in I6.
11. Write calls become `PreparedOperation` before execution and bind exact `capabilityId`, `capabilityContractIdentity`, canonical input snapshot, operation fingerprint, dependency fingerprint and dependency paths.
12. A write requiring approval performs zero side effects before the approval transition.
13. Conversational acknowledgement remains distinct from HITL approval; only the typed prepared-operation approval transition can authorize resume.
14. Approved write recovery does not invoke Planner. It reconstructs no capability from natural language or input shape.
15. Prepared operations without exact capability identity, with contract identity drift, stale dependencies, canonical input drift, effect drift or operation fingerprint mismatch are invalidated before execution.
16. Approved write execution uses the prepared `operationId` as Core idempotency key. Replaying the same approved operation does not duplicate the side effect.
17. Policy deny/invalid input and bounded recovery failures cross the cognitive boundary only as typed `tool_control_failure` reason codes. Free-form Policy/input error text is not persisted into TaskState.
18. Approval admission exposes only the bounded literal `approval_required`, not free-form Policy reason text.
19. `tool_control_failure` is a `PLANNING_TRIGGER`, but its business-state transition is intentionally no-op; reducer revision/idempotency still record causal ordering.
20. Failure primary causes are consumed at `hotel-task-planner-entry`, not inside the hotel business Planner. Unchanged business state therefore cannot automatically reissue the failed `CALL_TOOL`.
21. `ToolObservationEvent.failure` is likewise guarded at the planner-entry boundary so I7 cannot accidentally introduce automatic retry by merely mapping a tool failure.
22. Explicit retry remains a separate later user/server cause and stays subject to existing bounded retry rules.
23. The normal hotel Planner remains unchanged by the final I6 diff.
24. The public TaskState Reducer wrapper remains transparent; typed control validation occurs at the schema boundary and business transition semantics live in reducer core.
25. I6 performs no production runtime wiring, no deployment, no provider-backed journey and no real HMS side effect.

## Adversarial findings closed

### F1 — Admission narrowing / rejected surfaces
The initial admission union made rejected variants difficult to narrow and risked unsafe casts. Rejected surfaces now explicitly make canonical input/effect/fingerprint unavailable. No cast-based bypass was introduced.

### F2 — PreparedOperation capability ambiguity
`operationType=reserve` is insufficient to distinguish single-room from multi-room execution after a crash. PreparedOperation now persists exact capability and contract identity; recovery never infers the capability from input shape.

### F3 — Local Policy denial had no authoritative cause
An early I6 candidate returned a local `blocked` result. This could leave the orchestration layer without an authoritative cause for a response. Policy/input/recovery control failures now produce a typed ServerControlEvent.

### F4 — PLANNING_TRIGGER could auto-reissue the failed tool
Once `tool_control_failure` became a PLANNING_TRIGGER, unchanged TaskState could have caused the normal business Planner to emit the same `CALL_TOOL` again. A cross-boundary planner entry now consumes server/tool failure primary causes and emits bounded degradation before normal business routing.

### F5 — Failure handling was briefly duplicated inside the domain Planner
Adversarial reinspection found the failure guard already belonged in `hotel-task-planner-entry`. The redundant domain-Planner guard was reverted; there is one failure-cause authority.

### F6 — Reducer control handling was briefly duplicated
The public Reducer wrapper initially normalized `tool_control_failure` into a synthetic no-op lifecycle transition while reducer core was later taught the typed control directly. The wrapper has been restored to its transparent I5 form; reducer core now handles the typed no-op explicitly.

### F7 — Approval admission leaked a free-form Policy reason across I6
The approval result carried `policy.reason: string` despite the result kind already encoding the decision. The boundary now emits only literal `approval_required`.

### F8 — Test expectation drift masked the intended causal contract
Earlier CI reds after the control-failure refactor were stale test expectations, not runtime regressions. Tests were rewritten to verify the complete causal path rather than the former local `blocked` result.

## Evidence

I6-specific coverage in `test/acp-3.0-core-tool-integration.test.mjs` verifies at minimum:

- side-effect-free Core admission and canonicalization;
- read causal revalidation, invocation recording/dispatch and raw-result isolation;
- stale/tampered CALL_TOOL rejection before Core dispatch;
- Policy deny → typed planning control → Reducer → PLANNING_TRIGGER → bounded degradation with zero auto-retry;
- tool observation failure guarded at the cross-boundary Planner entry;
- write proposal canonicalization and zero-side-effect approval wait;
- exact PreparedOperation approval resume without Planner;
- Core-idempotent replay of the same approved operation;
- missing/drifted capability contract identity invalidation before write;
- read recovery before lease expiry;
- lease expiry terminalization followed by one bounded recovery planning control;
- recovery Policy denial terminalization followed by one bounded planning control.

The substantive head `203b8c4f2b75b92486687c3e8fe2f484c198e9ab` passed the complete repository `core-ci #766`, including all prior ACP-3.0 and legacy regression/safety suites.

## CI history relevant to the gate

- `#750` — RED: TypeScript discriminated-union narrowing in the first I6 candidate.
- `#751` — GREEN: mechanical narrowing repair; baseline integration compiled/regressed cleanly.
- `#752` — RED: 516/517; test incorrectly assumed a prefixed operation fingerprint. Core uses SHA-256 hex; test was corrected, Core was not changed.
- `#753` — GREEN: initial I6 contract suite.
- Adversarial review then rejected closure because local Policy denial had no typed orchestration cause.
- `#759` — RED: reducer-core narrowing after typed control introduction.
- `#760` — RED: 516/517; stale test still expected local `blocked`.
- `#761` — RED: same stale behavioral expectation while failure-loop hardening was under review.
- `#762` — RED: 520/521; all new adversarial behavior passed except one response-intent expectation, which exposed duplicate failure taxonomies.
- Domain-Planner duplication was removed and failure authority retained at planner entry.
- `#766` — GREEN on exact substantive I6 head `203b8c4f2b75b92486687c3e8fe2f484c198e9ab`.

## Scope audit

Final diff from I5 closure to substantive I6 head changes only:

- `src/cognitive/contracts.ts`
- `src/cognitive/core-tool-integration.ts`
- `src/cognitive/core-tool-preconditions.ts`
- `src/cognitive/events.ts`
- `src/cognitive/hotel-task-planner-entry.ts`
- `src/cognitive/orchestration-cycle.ts`
- `src/cognitive/task-state-reducer-core.ts`
- `src/cognitive/task-state-schema-boundary.ts`
- `src/core/tool-admission.ts`
- `test/acp-3.0-core-tool-integration.test.mjs`

The final substantive diff does **not** modify `src/cognitive/hotel-task-planner.ts`, `src/cognitive/task-state-reducer.ts`, production orchestrator/runtime, HMS adapters, model providers, Worker deployment configuration or staging/production paths.

## Gate

`I6_CORE_TOOL_INTEGRATION_PASS = PASS`

`I6 = CLOSED`, conditional only on exact-head closure CI for this documentation commit.

Next allowed block after closure CI: **I7 — Observation Mapper**. Production runtime wiring, deployment, provider-backed J01 and real HMS side effects remain blocked until their own gates.
