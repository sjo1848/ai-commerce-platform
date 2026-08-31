# ACP 2.6.9-R2.2 — Natural Receptionist Dialogue Layer

Status: `IMPLEMENTATION / QA PENDING`
Parent: `ACP 2.6.9 R2 — Natural Receptionist Experience`
Depends on: `R2.1 — Receptionist Product Contract + Acceptance Corpus — PASS`

## Scope boundary
R2.2 changes only the visible dialogue layer and conversational message classification.

Included:
- greeting/social/help intent classification;
- natural Argentine-Spanish response composition;
- server-built `GroundedFactEnvelope` for completed HMS tool results;
- opaque fact placeholders generated into model context;
- server validation of model drafts before hydration;
- deterministic fallback on provider failure or invalid/ungrounded draft;
- naturalized clarification wording constrained to server-declared missing fields;
- social-only turns forbidden from mutating operational conversation state.

Explicitly excluded until later substages:
- semantic memory v2 (`R2.3`);
- multi-room conversation state (`R2.4`);
- multi-room reservation execution (`R2.5`);
- model comparison/selection (`R2.6`).

## Grounding boundary
Operational values are not authored by the model. Core builds a `GroundedFactEnvelope` from authoritative HMS output. The model receives opaque placeholders such as `{{room_1_number}}` and may compose connective prose around them.

Before hydration, Core rejects drafts that:
- reference unknown placeholders;
- omit required authoritative placeholders;
- contain raw numeric/currency/identifier values outside placeholders;
- contain trusted execution metadata;
- introduce blocked unsupported hotel-detail claims such as amenities/policies not present in the envelope.

Only after validation does Core replace placeholders with authoritative server values.

## Conversational boundary
Pure greeting, social acknowledgement and help requests are separated from operational intents. A greeting combined with an operational request must still route the operational intent.

Social-only routes must have empty `missing` and empty `statePatch`; otherwise the LLM route is rejected and deterministic fallback is used.

Clarification rewriting may ask only for fields explicitly declared missing by Core/router.

## Tests added/changed
- `test/model-responder.test.mjs`
  - server-owned fact envelope;
  - placeholder hydration;
  - unsupported-claim rejection;
  - raw-value/unknown-placeholder rejection;
  - natural greeting;
  - bounded clarification;
  - provider fallback.
- `test/llm-routing-contract.test.mjs`
  - social/greeting routing contract;
  - operational greeting precedence;
  - social state mutation rejection.

## Exit criteria
R2.2 is not complete until:
1. typecheck + full regression suite PASS;
2. new R2.2 tests PASS;
3. Cloudflare Worker dry-run PASS;
4. QA reviews grounding and failure behavior;
5. no P0/P1/P2 remains in R2.2 scope.

This evidence must be updated with exact artifact/CI references before R2.2 is marked complete.