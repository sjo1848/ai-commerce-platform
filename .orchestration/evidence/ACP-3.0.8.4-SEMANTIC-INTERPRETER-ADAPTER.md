# ACP-3.0.8.4 — Semantic Interpreter Adapter Evidence

Status: `FINAL CANDIDATE / EXACT-HEAD CI PENDING`

## Prerequisite

`ACP-3.0.8.3 DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS`
- exact head `a8c91bd67fbcb1125a8f9f5daa4c97e6c6ce5102`
- core-ci #646 / `34762367166` PASS

## Candidate scope

Implemented without runtime wiring:
- semantic-only `InterpreterInput` and `InterpreterOutput` contracts;
- minimal TaskState projection that exposes semantic summaries but not operational room IDs, booking IDs, fingerprints, approval or execution authority;
- explicit `set | clear`, with omission meaning noChange;
- RoomReference and BookingReference remain semantic references only;
- requested goal remains separate from current `operationIntent`;
- abort-current-operation remains distinct from cancellation of an existing booking;
- read/retry/show-options/interaction directives are bounded and semantic;
- temporal normalization provenance must exactly match trusted server temporal context and the semantic date changes it claims to explain;
- strict validator rejects unknown fields, malformed references, invalid dates, operational authority fields, empty task outputs and outputs outside the supplied domain semantic contract;
- structured output schema contains semantic vocabulary only;
- `StructuredSemanticInterpreterAdapter` reuses the existing `ModelProvider` boundary with a compact semantic-only prompt;
- `ValidatedSemanticInterpreter` fails closed on invalid output or provider failure and performs no fallback NLU or automatic provider retry.

## Adversarial findings closed before push

1. Empty `{taskSemanticChanges:{}}` / `{directives:{}}` originally counted as a task signal. Closed: empty semantic containers are rejected.
2. Base provider schema is intentionally broad enough for Hotel v1, but tenant/domain contract may be narrower. Closed: runtime validation enforces the supplied `DomainSemanticContract` for goals, operation intents and read requests.
3. Temporal provenance cannot forge timezone/locale/trustedNow/policy or describe dates different from the semantic patch.
4. Provider input is bounded to 4,000 user-message characters and invalid input is rejected before provider invocation.

## Focused pre-push verification

Strict isolated TypeScript compile: PASS.

Focused tests: `23/23 PASS`, covering semantic patches, authority-field rejection, semantic references, goal vs commit, abort vs cancel, compositional read+intent, social/help isolation, temporal provenance, date validation, context minimization, schema authority boundaries, domain narrowing, provider failure and no-retry behavior.

All provider behavior tests use fakes. No real provider inference occurred.

## Gate

`SEMANTIC_INTERPRETER_ADAPTER_PASS` requires exact-head repository CI and final contradiction review. Runtime orchestration remains blocked until ACP-3.0.8.5.
