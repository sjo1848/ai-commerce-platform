# ACP-3.0.8.4 — Semantic Interpreter Adapter Evidence

Status: `SEMANTIC_INTERPRETER_ADAPTER_PASS`

## Exact gate

- exact head: `6ecb687f1912003c86f772420759e6d25bce720f`
- core-ci: #647 / `34762941975`
- typecheck/tests: PASS
- staging E2E runner syntax: PASS
- Cloudflare Worker config: PASS

## Implemented boundary

- semantic-only InterpreterInput/Output;
- minimal TaskState projection with no operational room/booking IDs;
- explicit `set | clear`, omission = noChange;
- semantic RoomReference / BookingReference only;
- goal and operationIntent separated;
- abort-current-operation distinct from cancel-booking;
- bounded read/retry/show-options/interaction directives;
- trusted temporal provenance bound to server-supplied temporal context and matching date patches;
- strict validator rejects unknown/operational fields, invalid references/dates, empty task output and semantic values outside the supplied domain contract;
- semantic-only structured output schema;
- existing ModelProvider reused through a narrow adapter;
- invalid output/provider failure fail closed with no fallback NLU or automatic retry.

## Verification

Pre-push isolated TypeScript: PASS.
Focused fake-provider and contract tests: `23/23 PASS`.
Exact repository CI: PASS.

No real provider inference, runtime routing replacement, deployment, HMS mutation or approval consumption occurred.

## Carry-forward

3.0.8.5 must convert validated semantic output into revision-guarded TaskEvent + ephemeral PlanningTrigger deterministically, then reduce and plan offline before any production/runtime cutover.
