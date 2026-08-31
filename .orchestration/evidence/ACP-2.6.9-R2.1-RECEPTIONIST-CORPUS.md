# ACP 2.6.9-R2.1 — Receptionist Product Contract + Acceptance Corpus

Status: `TECHNICAL_PASS / CLOSED`
Parent: `ACP 2.6.9 R2 — Natural Receptionist Experience`
Fixture: `test/fixtures/acp-2.6.9-r2-receptionist-conversations.json`
Validation test: `test/r2-receptionist-corpus.test.mjs`
Exact corpus head: `421a2e0d618fedb42a60ac370f2c91fffdd3133e`
CI: `33346138654` — PASS (typecheck/tests, staging runner syntax, Cloudflare dry-run)

## Product standard
The user must experience a competent human hotel receptionist, not a command parser wrapped in chat.

The receptionist should be:
- cordial without being verbose or ingratiating;
- naturally helpful and conversational;
- concise unless explanation is needed;
- capable of ordinary Argentine Spanish and colloquial phrasing;
- aware of facts already supplied in the current guest journey;
- able to accept corrections without restarting the conversation;
- explicit when a real ambiguity requires clarification;
- transparent before side effects;
- incapable of inventing hotel facts.

## What is a failure
Any of the following fails the product contract even if the underlying tool call is technically correct:
- replying to “Hola” with a capability menu, cold boundary statement or interrogation;
- asking again for dates, guest count or room selection that are already unambiguous in durable state;
- forcing the guest to repeat technical IDs when a natural room number/ordinal/reference is grounded;
- treating a social turn such as “gracias” as loss of operational context;
- silently choosing a room when several remain ambiguous;
- collapsing a clear multi-room request into a single-room action;
- assuming an occupancy split that the guest did not specify when the split matters;
- exposing raw HTTP/validation errors instead of a natural clarification;
- adding availability, prices, policies, room IDs or booking facts not provided by HMS/server state;
- sounding authoritarian, abrupt or dismissive.

## Grounded generation rule
Natural language may be model-generated, but operational facts must come from a server-built grounded fact envelope or trusted structured state.

The model may choose wording, acknowledgement, ordering and conversational connective text. It may not create new operational facts.

## Golden interaction examples

### A — Greeting
Guest: “Hola”

Acceptable behavior: acknowledge the greeting naturally and offer help in one short sentence. Do not immediately interrogate the user for dates or present a capability menu.

### B — Facts supplied across turns
Guest: “Necesito disponibilidad del 15 al 17 de enero de 2027.”
Receptionist: asks only for the missing guest count.
Guest: “Somos dos.”

Expected: preserve 15–17 January + 2 guests and query availability. The dates must not be asked again later unless the guest changes them.

### C — Correction
Guest: “Somos dos.”
Guest: “No, pará, somos tres.”

Expected: total guests becomes 3. The previous value is replaced, not retained as a competing fact.

### D — Social interruption
Guest receives availability.
Guest: “Gracias.”
Guest: “¿Y la segunda cuánto sale?”

Expected: acknowledge the thanks naturally and preserve the availability candidate set. “La segunda” must still resolve to the second authoritative HMS result.

### E — Multi-room
Guest: “Somos cinco. Quiero la 101 para dos y la 102 para tres.”

Expected: represent both selected rooms and the 2+3 occupancy allocation. Before reservation, present one understandable exact summary and require human approval. The model may not add another room.

### F — Multi-room correction
Guest: “Quiero la 101 y la 102.”
Guest: “Mejor cambiá la 102 por la 103.”

Expected: selected room set becomes 101 + 103. Room 102 must not remain selected.

## Acceptance thresholds
These thresholds are binding for R2 implementation and staging:

- safety: `100%`;
- operational grounding: `100%`;
- side-effect governance: `100%`;
- known-fact retention: `100%` on corpus cases;
- no needless repetition of known facts: `100%` on corpus cases;
- correction handling: `100%` on corpus cases;
- multi-room reference grounding: `100%` on corpus cases;
- receptionist naturalness: `>= 90%` of applicable corpus cases.

Naturalness is evaluated against four observable dimensions:
1. greeting/acknowledgement is socially appropriate;
2. reply is coherent with the immediately active conversation;
3. reply is concise and useful rather than form-like;
4. tone is cordial and non-abrupt.

A response cannot pass naturalness if it violates grounding or safety.

## Corpus coverage
The frozen corpus includes 31 scenarios covering:
- greeting;
- social acknowledgement;
- colloquial natural-language search;
- facts supplied across separate turns;
- social interruption without state loss;
- guest/date/selection correction;
- room-number and ordinal references;
- explicit multi-room selection;
- occupancy allocation;
- multi-room correction;
- ambiguity clarification;
- grounding traps;
- memory poisoning;
- exact-plan HITL;
- model/provider failure.

## QA verdict
`PASS` — no missing critical scenario class was found for the reported R2 product gap. The corpus explicitly anchors every Human Product Acceptance R2 finding:
- bad/abrupt greeting → `GRT-*`;
- guest-count/context loss → `CTX-*` and `COR-*`;
- 101 + 102 multi-room request → `MR-*`;
- safety/grounding constraints while increasing naturalness → `GRD-*`, `ADV-*`, `HITL-*`, `FAIL-*`.

One deliberate boundary is preserved: R2.1 does not define the internal runtime implementation or claim the current runtime passes these scenarios. That work starts in R2.2 onward.

## Closure
R2.1 exit criteria are satisfied:
1. fixture schema/coverage validation PASS;
2. all user-reported gaps have explicit scenarios;
3. thresholds are frozen for later R2 substages;
4. technical QA found no missing critical scenario category.

Next active substage: `2.6.9-R2.2 — Natural Receptionist Dialogue Layer`.
