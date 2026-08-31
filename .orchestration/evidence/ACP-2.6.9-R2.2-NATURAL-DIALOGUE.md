# ACP 2.6.9-R2.2 — Natural Receptionist Dialogue Layer

Status: `TECHNICAL_PASS / PRE-CRITIC`
Parent: `ACP 2.6.9 R2 — Natural Receptionist Experience`
Depends on: `R2.1 — Receptionist Product Contract + Acceptance Corpus — PASS`
Substantive Artifact A: `6fa16baa52f0d8417f2d86f2204832db8715ae58`
Exact-artifact CI: `33348863405` — `PASS`
Foundation tests: `97/97 PASS`
QA: `.orchestration/reviews/ACP-2.6.9-R2.2-QA.md` — `PASS`
Open P0/P1/P2: `0 / 0 / 0`

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
- copy authoritative raw fact values outside placeholders;
- contain trusted execution metadata;
- introduce unsupported amenities/policies;
- introduce common qualitative room/hotel claims such as comfort, size, quietness or quality that were not grounded by a placeholder.

Only after validation does Core replace placeholders with authoritative server values.

`FACTS`, history and user/context text are explicitly treated as data rather than instructions in the responder prompts.

## Availability truncation correctness
The response layer may expose at most five detailed room options, but it may not confuse that presentation bound with HMS truth.

Final Artifact A therefore distinguishes:
- `room_count`: total authoritative available-room count returned by HMS;
- `shown_room_count`: number of detailed room options exposed to the model, present only when the list is truncated.

When `shown_room_count` exists, both counts are required placeholders and the draft must include explicit subset-disclosure language (for example “te muestro…”). Invalid drafts fail closed. Deterministic fallback follows the same rule.

This closes the P2 found by the first Independent Critic pre-review.

## Conversational boundary
Pure greeting, social acknowledgement and help requests are separated from operational intents. A greeting combined with an operational request must still route the operational intent.

Social-only routes must have empty `missing` and empty `statePatch`; otherwise the LLM route is rejected and deterministic fallback is used.

Clarification rewriting may ask only for fields explicitly declared missing by Core/router. Server-detected missing required fields go through the same bounded dialogue responder.

## Exact verification
Final substantive artifact `6fa16baa52f0d8417f2d86f2204832db8715ae58`:
- core-ci run `33348863405` — PASS;
- `97/97` Node tests — PASS;
- TypeScript typecheck — PASS;
- staging reservation E2 runner syntax — PASS;
- Wrangler Worker dry-run — PASS;
- bindings validated: Sessions DO, HMS Service Binding, Workers AI.

Key regressions proving R2.2 behavior:
- pure greeting classified as conversational rather than operational;
- social-only model output cannot mutate durable operational state;
- orchestrator routes greeting through dialogue responder;
- server-side missing-field clarification goes through bounded dialogue responder;
- GroundedFactEnvelope exposes server-owned fact placeholders;
- model prose hydrates authoritative placeholders;
- unsupported amenities fail closed;
- invented qualitative room claims fail closed;
- raw operational values and unknown placeholders fail closed;
- total availability count remains authoritative when detail list is truncated;
- truncated natural response must disclose that only a subset is shown;
- provider failure falls back deterministically;
- quote intent still cannot invent a room identifier;
- all previous HITL/idempotency/tenant/ownership/guest-identity tests remain green.

## REWORK history
- CI `33348457429`: `90/94 PASS`; four legacy assertions described the old pre-R2.2 response contract. Safety intent was retained while expectations were updated.
- CI `33348592481`: `94/94 PASS`.
- QA identified qualitative-claim grounding risk and hardened it.
- CI `33348680976`: `95/95 PASS` on candidate Artifact A `2c249399...`.
- Independent Critic pre-review found one P2: truncating detailed room results also truncated the reported total count.
- REWORK corrected total-vs-shown semantics and added two regressions.
- CI `33348863405`: `97/97 PASS` on new Artifact A `6fa16baa...`.

## Exit criteria status
1. typecheck + full regression suite PASS — `YES`;
2. new R2.2 tests PASS — `YES`;
3. Cloudflare Worker dry-run PASS — `YES`;
4. QA grounding/failure review PASS — `YES`;
5. zero P0/P1/P2 — `YES`;
6. fresh Independent Critic — `PENDING`;
7. merge + post-merge regression — `PENDING`.

R2.2 is technically ready for a fresh Independent Critic review but is not closed until critic + integration verification complete.