# ACP-3.0.8.7.B — J01 Provider Preflight Evidence

Status: `J01_PROVIDER_PREFLIGHT_READY`
Gate head: `6df40c6f850cd5ebcb3c70c5e4c71b3754d4ea27`
Authoritative CI: core-ci #663 / `34776673474`
Real provider calls executed: `false`
Tool admission: `false`
HMS calls: `false`
Approval issuance/consumption: `false`
Deployment: `false`

## Boundary implemented

`runJ01ProviderSemanticPreflight(...)` is a validation-only boundary for the first provider-backed J01 semantic turn.

It performs, at most:

`clean TaskState -> build semantic-only request -> one budgeted provider inference -> strict InterpreterOutput validation -> in-memory reducer/Planner traversal -> verify next step is read-only availability -> stop`.

It deliberately does not call Planner tool admission, Policy, AgentCoreExecutor, HMS, approval issuance/consumption, persistence, response publication, or any write path.

## Protected provider dispatch

A provider call is rejected unless the supplied provider is an actual `DurableExperimentBudgetProvider`. This reuses the existing durable experiment ledger rather than adding a second quota system.

Before any budget reservation or provider dispatch, the preflight rejects:

- an unbudgeted provider;
- non-clean operational TaskState;
- invalid local interpreter input.

Provider failures are not retried. Experiment-budget uncertainty remains explicit, and a bounded underlying provider category may be preserved without provider prose.

## Semantic / planning guard

- The provider receives the ACP-3 semantic interpreter request only; no HMS tool IDs are included in the request.
- Provider output must pass the existing strict InterpreterOutput validator; there is no regex/NLU fallback.
- Provider identity evidence (`model`) is required before a result can be accepted.
- A provider result is accepted only if deterministic planning yields `CALL_TOOL availability` with `effectClass=read`.
- Any write CALL_TOOL is blocked by the preflight.
- A successful preflight still leaves no pending tool invocation, PreparedOperation, or execution state.

## Focused tests

The candidate covers:

1. one budgeted semantic inference leading to read-only availability;
2. raw/unbudgeted provider rejected before dispatch;
3. dirty operational state rejected before budget/provider dispatch;
4. invalid local input rejected before budget/provider dispatch;
5. invalid semantic output rejected without fallback parsing;
6. provider failure invoked once with reservation retained and no automatic retry/release;
7. missing provider identity rejected after accounted inference;
8. valid semantics that do not produce the expected J01 availability read rejected fail-closed.

All repository CI stages are GREEN at the gate head: strict typecheck/tests, staging E2E syntax and Wrangler configuration dry-run.

## Candidate history

- `0677220d7709a0dc6f441790e0329a01da695ba8`, core-ci #660 / `34776420997`: RED, `exactOptionalPropertyTypes` narrowing only.
- `a96e127954d772d159ccdd0648e09eb68059b542`, core-ci #661 / `34776469990`: RED, test-only import path error; production preflight compiled.
- `dda5497278cf19bd243bebfa579ecb690886660c`, core-ci #662: GREEN intermediate. Independent contradiction review then identified that the preflight should require the durable budget wrapper explicitly and distinguish local input rejection from provider failure.
- `6df40c6f850cd5ebcb3c70c5e4c71b3754d4ea27`, core-ci #663 / `34776673474`: final hardened GREEN gate.

## Verdict

`J01_PROVIDER_PREFLIGHT_READY`

This is readiness only. No real provider inference has been executed. The next protected action remains blocked while `provider_calls_authorized=false`.
