# ACP-3.0 I4 — Semantic Interpreter Boundary

Status: `PASS / CLOSED`
Date: 2026-09-15
Base closure authority: I3 head `f07ba8540fb82bd87aab9cacd955a850fdf718ef`
Design authority: ACP-3.0.5 Semantic Interpreter Contract, final gate PASS with amendments A1–A13.
Branch: `feature/acp-3.0-i4-semantic-interpreter`
Substantive PASS head: `c82ad04fe09f470763878c78815933520cba590d`
Substantive exact-head CI: `core-ci #721` — PASS

## Scope

I4 implements only the semantic boundary:

`current user text + bounded trusted context -> model InterpreterOutput -> strict whole-output admission -> server-owned UserSemanticEvent + ephemeral PlanningTrigger directives`

The real ACP runtime/orchestrator is not wired to this boundary in I4.

## Implemented components

- `src/cognitive/semantic-interpreter.ts`
  - bounded trusted context projection;
  - closed InterpreterOutput runtime admission;
  - semantic cross-field validation;
  - exact admission identity + deep-freeze;
  - TaskState-origin binding for later server materialization;
  - UserSemanticEvent / PlanningTrigger materialization only after admission.
- `src/cognitive/semantic-interpreter-adapter.ts`
  - one structured inference through the existing `ModelProvider` abstraction;
  - closed output schema;
  - compact semantic-only system contract;
  - server-owned temporal policy projection;
  - typed degradation for provider/invalid-output/unknown-policy paths;
  - no second semantic attempt and no deterministic NLU fallback.

No ACP-3.0 runtime path consumes these components yet.

## Trusted input projection

The Interpreter receives only bounded context necessary to interpret the current turn:
- current user message;
- requested task semantics/lifecycle;
- booleans/counts summarizing grounded state;
- bounded presentation entities with server-created handles, visible labels, type and order;
- bounded DialogueAnchor projection;
- trusted now/timezone/locale/temporal-policy identity;
- optional trusted booking window;
- server-owned explicit semantic retryable-target context;
- closed hotel semantic vocabulary.

It does not receive:
- raw HMS/provider availability payloads;
- internal roomId/bookingId grounding;
- observation IDs;
- dependency/operation fingerprints;
- PreparedOperation IDs or input snapshots;
- policy/approval outcomes;
- arbitrary transcript history.

Oversized user messages, presentation sets and labels fail closed instead of being silently truncated.

## InterpreterOutput

Closed v1 semantic shape:
- `classification`: task | social | help | unknown;
- `taskSemanticChanges` using explicit `set(value)` / `clear` patches;
- bounded ephemeral directives: retry, readRequest, showOptions, abortCurrentOperation, interaction;
- temporal resolution provenance when date values are normalized.

The provider never authors event/session/task/revision/causation metadata.

## Final admission rules

- recursively closed shapes; unknown/prohibited fields reject the entire output;
- no ambiguous null patches and no partial salvage;
- strict enums/unions plus bounded strings/arrays/counts;
- real ISO calendar-date validation;
- no internal room/booking grounding reference type;
- goal and operationIntent must remain semantically compatible after applying patches;
- abortCurrentOperation requires operationIntent=clear in the same admitted output;
- commit may exist before final operational target grounding;
- read + commit may coexist without selecting a tool;
- task chatter cannot create an interaction short-circuit that masks durable task work;
- a task output containing only chatter is invalid;
- unknown classification cannot become Planner artifacts;
- occupancy must agree with effective room count and, when guests are known, with the effective guest total;
- contextual room and booking references are type-separated;
- focused room references require room focus; booking references require booking focus;
- room current_selection and booking current_selection use distinct server grounding authorities;
- room presented_set requires a homogeneous room presentation set;
- targetless retry is valid only with exactly one explicit server-projected retryable semantic target;
- retained historical tool failures do not imply retryability;
- semantic retry targets map only to Planner vocabulary and never to tool IDs/raw args;
- normalized date `set` patches require complete exact temporal provenance;
- temporal provenance must bind trustedNow/timezone/policy and cover exactly every checkIn/checkOut date set in that output;
- bookingWindow constraints are validated server-side;
- social/help output cannot mutate task semantics;
- provider absence/error/invalid output creates no UserSemanticEvent and no semantic fallback NLU.

## Authority binding

`TrustedInterpreterInput` is accepted only when it is the exact object produced by the server builder. Successful admission deep-freezes a copied output and records its origin authority internally.

Materialization then requires:
- exact admitted output identity;
- matching originating sessionId;
- matching taskId;
- matching TaskState stateRevision;
- valid server-owned eventId/occurredAt/optional causationId.

Cross-session, cross-task, stale/future-revision and cloned-output bypass attempts fail closed.

## Temporal Policy v1

The provider receives the policy as server-owned data rather than relying on a hidden heuristic:
- yearless dates prefer the nearest valid future occurrence;
- ranges resolve as one unit;
- year rollover is explicit when the second endpoint crosses the year boundary;
- explicit-year dates are preserved and never silently shifted forward;
- day-only expressions without trusted month scope are ambiguous;
- unsupported/multiply-interpretable relative expressions are ambiguous;
- optional booking window constrains admitted normalized dates.

## Provider boundary

The adapter uses the existing `ModelProvider.completeStructured` abstraction but I4 performs no real provider-backed validation run.

Rules:
- one structured semantic inference attempt;
- provider-facing schema is closed;
- user message and visible labels are explicitly untrusted data;
- prompt contains semantic contract, authority boundaries and prohibitions, not workflow/tool-routing logic;
- output always passes server admission before artifacts are created;
- provider exception/invalid output degrades honestly;
- no regex parser, second deterministic NLU or hidden retry semantic pass.

## Adversarial review findings incorporated

The initial implementation candidate was not accepted despite GREEN CI. Review discovered and closed:
1. public materialization could be called with a valid-looking but never-admitted object;
2. trusted input silently truncated long messages/labels;
3. post-admission objects were mutable;
4. goal/commit and occupancy/room-count inconsistencies could be deferred too late;
5. unknown classification could have reached Planner as an empty trigger;
6. semantic retry vocabulary did not exactly match Planner vocabulary;
7. temporal-policy identity alone did not expose the policy semantics to the model;
8. Interpreter artifacts could have been cross-bound to another session/task/revision;
9. failure-history length was incorrectly treated as retryable-operation context;
10. task chatter such as `gracias, reservála` could mask business work through an interaction short-circuit;
11. room and booking contextual anchors shared an overly broad type check;
12. date patches could be admitted without complete temporal provenance.

All findings were repaired locally inside I4; no I1–I3 contract had to be reopened.

## Final A1–A13 review

- A1 Patch semantics — PASS.
- A2 Contextual references — PASS; bounded and type-separated, no internal IDs.
- A3 Temporal policy — PASS; explicit server-owned policy + exact mandatory provenance.
- A4 Goal / commit / abort — PASS.
- A5 Read + commit composition — PASS.
- A6 Retry bounded — PASS; server-projected retry context, no failure-history inference.
- A7 Occupancy semantics — PASS.
- A8 Strict schema admission — PASS; whole-output rejection, no salvage.
- A9 Quoted/meta/injection boundary — PASS.
- A10 Context minimization — PASS.
- A11 Failure boundary — PASS; no semantic fallback event.
- A12 Commit before final target grounding — PASS, tested independently from temporal normalization.
- A13 Candidate context bounded to presentation semantics — PASS; raw HMS/provider observations excluded.

Cross-contract review against I2/I3: PASS.

## Validation evidence

Substantive exact-head evidence:
- SHA: `c82ad04fe09f470763878c78815933520cba590d`
- `core-ci #721`: PASS
- typecheck/tests: PASS
- staging E2E runner syntax validation: PASS
- Cloudflare Worker config validation: PASS

The implementation remains additive and isolated from runtime composition.

Reviewer-independence limitation: GitHub Actions provides independent execution evidence, but this runtime did not provide a separate human or independent second-agent code reviewer. The adversarial review above was performed as a distinct contract/contradiction pass before granting the gate.

## Non-goals preserved

- no prompt optimization against fixture phrases;
- no real provider call;
- no regex/deterministic fallback NLU;
- no orchestration/runtime wiring;
- no Reference Resolver implementation;
- no Planner/Reducer/Core/Policy/Executor modification;
- no HMS read/write;
- no deployment.

## Gate

`I4_SEMANTIC_INTERPRETER_PASS = PASS`

`I4 = CLOSED`

Next permitted block: `I5 — orchestration reduce -> bounded grounding -> normalized trigger -> deterministic Planner`, still isolated from the production runtime until I5 passes its own gate.
