# ACP-3.0 I4 — Semantic Interpreter Boundary

Status: `ACTIVE / IMPLEMENTATION CANDIDATE`
Date: 2026-09-15
Base closure authority: I3 head `f07ba8540fb82bd87aab9cacd955a850fdf718ef`
Design authority: ACP-3.0.5 Semantic Interpreter Contract, final gate PASS with amendments A1–A13.
Branch: `feature/acp-3.0-i4-semantic-interpreter`

## Scope

Implement only the server-owned semantic boundary around model output:

`current user text + bounded trusted context -> model InterpreterOutput -> strict whole-output admission -> UserSemanticEvent patch + ephemeral PlanningTrigger directives`

This block does not integrate the model/provider into the runtime or orchestrator.

## Trusted input projection

The Interpreter input contains:
- current user message;
- bounded requested task semantics;
- lifecycle;
- boolean/count summaries of current grounded state;
- bounded presentation entities with server-generated presentation handles and visible labels only;
- bounded DialogueAnchor projection;
- trusted now/timezone/locale/temporal policy identity;
- closed hotel semantic vocabulary.

It does not expose:
- raw HMS/provider payloads;
- roomId/bookingId operational grounding;
- observation IDs;
- dependency/operation fingerprints;
- PreparedOperation input snapshots or IDs;
- policy/approval results;
- arbitrary transcript history.

## InterpreterOutput

Closed v1 shape:
- classification: task | social | help | unknown;
- taskSemanticChanges using explicit `set(value)` / `clear` patches;
- bounded ephemeral directives: retry, readRequest, showOptions, abortCurrentOperation, interaction;
- optional temporal resolution provenance bound back to trusted temporal context.

The output contains no event envelope IDs. Event/session/task/revision/causation fields are server-owned and added only after successful admission.

## Admission rules

- recursive closed shapes; unknown fields reject the complete output;
- no ambiguous null patches;
- strict enums/unions and bounded strings/arrays/counts;
- real ISO calendar-date shape validation;
- no internal room grounding reference type;
- abortCurrentOperation requires operationIntent=clear in the same semantic output;
- explicit commit can exist before final operational target grounding;
- contextual anchor references must correspond to bounded trusted presentation/task context;
- ordered occupancy requires relevant anchor/selection context and cannot contradict effective known guests;
- temporal provenance must match exact trustedNow/timezone/policy and normalized emitted date patches;
- social/help output cannot mutate task semantics;
- provider absence/invalid output is rejection only; no semantic fallback is fabricated;
- valid fields are never partially salvaged from an otherwise invalid output.

## Materialization boundary

After admission, a server-owned envelope may materialize:
- a `UserSemanticEvent` only when durable semantic changes exist;
- a `PlanningTrigger` carrying only semantic ephemeral directives.

Mappings remain semantic:
- compare_price -> Planner `compare` directive;
- show_options -> showOptionsDirective;
- retry target is semantic (availability/quote/reservation/cancellation/modification), never a toolId.

No tool selection, policy decision, approval, operational grounding, idempotency, execution, Response Composer or runtime routing happens here.

## Initial synthetic/adversarial gate

Tests cover:
- trusted-context data minimization;
- set/clear and null rejection;
- whole-output rejection on additional/prohibited fields;
- operational room ID injection attempts;
- abort/clear invariant;
- commit before grounding;
- contextual anchor admission/failure;
- occupancy anchoring and guest-total consistency;
- temporal provenance binding;
- invalid calendar dates;
- read + commit composition;
- semantic retry without tool ID;
- compare semantic normalization;
- social/help mutation rejection;
- provider failure/no semantic fallback;
- server-owned event envelope materialization.

## Non-goals

- no prompt tuning against fixtures;
- no real provider call;
- no regex/deterministic NLU fallback;
- no orchestration wiring;
- no reference resolver implementation;
- no Planner/Core/Policy/Executor modification;
- no HMS read/write;
- no deployment.

## Gate

`I4_SEMANTIC_INTERPRETER_PASS` is NOT granted by this candidate. It requires exact-head CI plus adversarial review of the implementation against A1–A13 and the existing reducer/planner contracts.
