# ACP 2.6.9 R2 — Natural Receptionist Experience

Status: `AUTHORIZED / REWORK`
Parent gate: `2.6.9 — Human Product Acceptance`
Decision: `DEC-002 — Consolidar experiencia IA en HMS antes de segunda vertical`

## Problem statement
Human Product Acceptance showed that the current HMS agent can interpret and execute bounded hotel operations, but it still does not feel like a human receptionist. The product gaps are:

1. greeting/social behavior is abrupt and form-like;
2. user-facing prose is still largely deterministic even though routing uses a real LLM;
3. facts already supplied by the guest, especially guest count, are not reliably reused in free conversation;
4. the conversation state models only one selected room/booking and cannot represent a request such as reserving rooms 101 and 102 together;
5. the current acceptance corpus proves tool correctness better than natural receptionist quality.

## Architectural invariant
The LLM may interpret language, maintain conversational intent through structured patches, and compose natural receptionist responses from a server-provided fact envelope. It may not invent or author operational truth.

Deterministic/server-authoritative components remain:
- tenant/hotel/actor identity;
- Tool Registry and visible capabilities;
- canonical server validation;
- HMS availability, prices, rooms, reservations and inventory;
- Policy/HITL;
- approval fingerprint and exact approved plan;
- idempotency, ownership, audit and operation tokens;
- multi-room execution semantics and partial-failure handling.

## R2 sequence

### 2.6.9-R2.1 — Receptionist Product Contract + Acceptance Corpus
Goal: define what “feels like a human receptionist” means before implementation.

Deliverables:
- receptionist persona/tone contract: cordial, concise, helpful, non-patronizing, no abrupt command-parser language;
- golden multi-turn transcripts in Argentine Spanish;
- cases for greeting, thanks, correction, interruption, colloquial phrasing, ambiguity, remembered facts, change of mind and unsupported requests;
- explicit multi-room examples;
- measurable acceptance thresholds.

Exit criteria:
- frozen corpus approved by technical QA;
- zero operational assertions without grounded facts;
- no implementation changes required to close R2.1.

### 2.6.9-R2.2 — Natural Receptionist Dialogue Layer
Goal: replace template-dominated user-facing replies with natural model-written prose while keeping facts grounded.

Deliverables:
- explicit conversational intents for greeting/social/help/acknowledgement;
- server-built `GroundedFactEnvelope` containing only facts the model may mention;
- LLM response composer that may freely phrase the answer but may not add facts outside the envelope;
- deterministic safe fallback for provider failure.

Exit criteria:
- greetings and non-operational turns read naturally;
- tool-result replies vary naturally without changing facts;
- hallucination/grounding tests remain 100%.

### 2.6.9-R2.3 — Durable Semantic Memory v2
Goal: never ask again for an unambiguously known fact unless the user changes or clears it.

Deliverables:
- durable structured stay facts: dates, total guests, preferences and active conversational intent;
- explicit correction semantics (e.g. “no, somos tres” replaces two);
- provenance/source metadata where needed to distinguish user facts from tool facts;
- state isolation by tenant/actor/session;
- compaction that does not rely on replaying prose history.

Exit criteria:
- known dates/guest count survive long multi-turn conversations and runtime replacement;
- correction/clear operations are deterministic;
- cross-session/actor contamination tests = 0.

### 2.6.9-R2.4 — Multi-Room Conversation Model
Goal: represent what a human receptionist understands when the guest discusses several rooms.

Deliverables:
- authoritative room candidate set from HMS;
- `selectedRooms[]` instead of a single selected room;
- room references by number, ordinal and natural expressions;
- requested room count and optional occupancy allocation per selected room;
- ambiguity rules when distribution is unknown.

Exit criteria:
- “la 101 y la 102”, “las dos primeras”, “cambiá la 102 por la 103” resolve safely;
- model cannot introduce room IDs outside HMS candidates;
- occupancy inconsistencies trigger a natural clarification, not silent assumptions.

### 2.6.9-R2.5 — Multi-Room Reservation Orchestration
Goal: execute multi-room requests safely against HMS.

Deliverables:
- explicit execution semantics for several room reservations;
- one human confirmation summarizing the exact multi-room plan before side effects;
- exact-plan approval binding;
- idempotency and ownership across the set of operations;
- defined partial-failure/compensation behavior rather than pretending atomicity if HMS cannot provide it;
- cancellation semantics for one room vs all rooms.

Exit criteria:
- reserve 101 + 102 works end-to-end or fails closed with clear recovery;
- no unapproved extra room can be added;
- replay/conflict/partial-failure tests PASS;
- inventory is consistent after cancellation/cleanup.

### 2.6.9-R2.6 — Model Quality, Latency and Cost Evaluation
Goal: determine with evidence whether the current Workers AI model is good enough after the architecture stops constraining it artificially.

Deliverables:
- run the frozen R2 corpus against the current model;
- compare at least one viable alternative only if available within existing authorized resources;
- measure naturalness score, task correctness, grounding, latency, tokens, fallback rate and estimated cost;
- choose model/configuration based on evidence, not preference.

Exit criteria:
- chosen model meets quality thresholds without safety regression;
- no paid-resource expansion without explicit authorization.

### 2.6.9-R2.7 — Adversarial QA + Independent Critic
Goal: attack the full R2 implementation before staging acceptance.

Required coverage:
- prompt/tool-result injection;
- malicious attempts to alter trusted context;
- memory poisoning and stale-state reuse;
- ambiguous or invalid room references;
- multi-room approval tampering;
- partial failure/replay/idempotency;
- hallucinated prices/availability/policies;
- provider failure and fallback behavior.

Exit criteria:
- zero open P0/P1/P2;
- Pre-Critic artifact frozen;
- Independent Critic = PASS.

### 2.6.9-R2.8 — Real-Model Receptionist Staging E2E
Goal: prove the product in the same kind of free conversation that exposed the gap.

Required flows include:
- natural greeting and small social turn;
- dates and guest count supplied across separate turns and reused later;
- correction of guest count without losing dates;
- select one room by number and by ordinal;
- select two rooms (e.g. 101 + 102), clarify occupancy only when necessary;
- quote, reserve with HITL, verify HMS state;
- cancel one room and/or all selected bookings with separate HITL as required;
- cleanup and inventory restoration.

Exit criteria:
- automated evaluator PASS;
- controlled E2E PASS;
- no silent deterministic fallback on the evaluated natural-language path unless the test explicitly covers provider failure.

### 2.6.9-R2.9 — Human Product Acceptance
Goal: human reviewer converses freely with the staging receptionist.

Acceptance questions:
- Does it feel like a competent human receptionist rather than a form/chatbot?
- Does it remember information already provided?
- Does it handle corrections and references naturally?
- Can it safely handle multi-room requests?
- Are confirmations clear before writes?
- Is it trustworthy enough to proceed to the second vertical?

Verdicts:
- `ACCEPT` → close 2.6 as `PRODUCT_ACCEPTED` and unblock Fase 3 — Alquileres.
- `REWORK` → reopen only concrete findings and repeat the bounded cycle.

## Execution rule
Only one R2 substage is active at a time. A substage must meet its exit criteria and evidence must be persisted before the next substage becomes active. Ordinary technical REWORK returns automatically to implementation; only genuine product/risk decisions create a Human Gate.

## Current active substage
`2.6.9-R2.1 — Receptionist Product Contract + Acceptance Corpus`.
