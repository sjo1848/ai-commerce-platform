# ACP-3.0.8.5 — Orchestration Integration Evidence

Status: `ORCHESTRATION_INTEGRATION_PASS`
Exact gate head: `b6020d62b36481ae4efaa7f0db313997c6e31a0d`
Exact gate CI: core-ci #652 / run `34769395411` — PASS

## Scope

This gate proves the offline integration sequence through Core/Policy admission without runtime cutover or real tool execution:

`validated InterpreterOutput -> UserSemanticEvent -> Reducer -> optional server-owned selection grounding -> normalized PlanningTrigger -> deterministic Planner -> CALL_TOOL admission -> Policy -> reducer control event`.

It does not authorize or perform real provider inference, Worker deployment, HMS mutation, approval consumption, payment action or second-vertical work.

## Sub-gate A — cognitive orchestration boundary

Exact head: `1694b0df4aacb1771a9143a73fcba92704a4bd50`
core-ci #649 / run `34764771302` — PASS.

Proven properties:
- durable semantic changes reduce before directives are planned;
- generic ambiguity stays ephemeral and produces bounded ASK;
- unknown classification cannot advance an existing workflow;
- room references are grounded server-side against authoritative availability / DialogueAnchor rather than by the model or Planner;
- contradictory selection and reserve target fail closed;
- abort is distinct from booking cancellation and does not claim rollback after execution admission;
- retry/read/social directives remain bounded trigger state;
- internal work is finite (`maxInternalSteps=3`).

The earlier `9e988094c107e593188067fed5790a2b6a85fb51` was an intermediate non-gate head.

## Sub-gate B — Planner CALL_TOOL admission into existing Core/Policy authority

New contract: `PreparedOperation` now persists exact `capabilityId` and `toolId` in addition to operation/dependency fingerprints and canonical input. Approval resume therefore does not infer single-vs-multi or select a tool from generic operation type.

Admission properties:
- capability binding must match current `HotelTaskDefinition` + `DomainCapabilities`;
- Planner effect class must match the real registered tool contract;
- `preconditionFingerprint` is recomputed from current TaskState before admission;
- expected grounded input is recomputed from TaskState and compared exactly to Planner input;
- actual tool validation canonicalizes trusted server-owned fields before operation fingerprinting;
- Policy is evaluated by the existing `PolicyEngine`, not duplicated;
- read admission emits `ToolInvocationStartedEvent` and reduces state without executing the tool;
- write admission emits `OperationPreparedEvent` with exact capability/tool/input/fingerprints and no execution;
- execution admission revalidates binding, dependencies, canonical input, operation fingerprint and current Policy before `ExecutionStartedEvent`;
- returned executor request carries a server-owned operation idempotency key and exact approved operation fingerprint when approval is required;
- stale/tampered proposals fail closed.

### Candidate history

Candidate `9c1b4a817a173b692e39d5c3493afcdcc8281ff3`, core-ci #650 / run `34769238836`: RED at TypeScript typecheck only. Two narrowing defects were found:
1. `HotelCapabilityId` was not narrowed to write-capability identity before constructing `PreparedOperation`;
2. the initial PreparedOperation status was typed too broadly for `OperationPreparedEvent`.

No behavioral tests ran on that candidate. The design was unchanged; the type boundary was corrected.

Corrected admission head `7276fe562543f402afbd8eb502390c1816c786e1`, core-ci #651 / run `34769314148`: PASS, 473/473 tests, staging runner syntax PASS, Wrangler dry-run PASS.

Focused new admission cases passed:
- read proposal enters reducer without tool execution;
- Planner grounded-input tampering fails closed;
- stale precondition after user correction fails closed;
- read approval requirement is not bypassed;
- write persists exact capability/tool and canonical approval fingerprint;
- approved write resumes only exact PreparedOperation and returns executor request without execution;
- dependency correction blocks previously approved operation;
- auto-policy write does not fabricate human approval.

## Final cross-boundary proof

Exact gate head `b6020d62b36481ae4efaa7f0db313997c6e31a0d`, core-ci #652 / run `34769395411`: PASS.

Full suite result: `475 tests / 475 pass / 0 fail`.

The two final integration cases passed:
1. validated reservation stay semantics -> reduce -> Planner availability CALL_TOOL -> Core/Policy read admission -> pending invocation, with zero tool execution;
2. validated reserve commit -> reduce -> Planner reserve_single CALL_TOOL -> Core/Policy canonicalization -> exact approval-bound PreparedOperation, including trusted guest identity, with zero tool execution.

CI also passed staging E2E runner syntax and `wrangler deploy --dry-run`.

## Verdict

`ORCHESTRATION_INTEGRATION_PASS`

ACP-3.0.8.5 is closed. The next sub-stage is `ACP-3.0.8.6 — Observation Mapper + Response Boundary`.
