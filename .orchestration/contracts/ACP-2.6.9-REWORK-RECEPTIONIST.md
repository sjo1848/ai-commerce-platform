# ACP 2.6.9 — REWORK: Receptionist Conversation

Status: `AUTHORIZED / IN PROGRESS`

## Trigger
Human Product Acceptance returned `REWORK` on 2026-08-30 after free-form staging use showed three product failures:
1. conversation still feels rigid / not like a human receptionist;
2. guest-count facts can still be lost or not reused naturally;
3. a request such as “reservame la 102 y la 101” cannot be represented by the current single-room selection/reservation model.

The greeting experience was also judged brusque/aloof (“hola” should be handled as normal hospitality conversation, not as an unsupported command).

## Root-cause diagnosis
This is not primarily a raw-model quality issue. Staging already uses Workers AI with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The current architecture constrains the model so strongly that:
- the route LLM may classify/plan but kind=`message` is converted to fixed deterministic clarification text;
- the grounded responder lets the LLM choose only presentation metadata while operational prose is emitted from fixed templates;
- `ConversationState` stores one `guests` count, one `selectedRoomId` and one `activeBookingId`;
- `hms.createReservation` accepts one room only.

Therefore a stronger model alone would not fix the observed UX.

## Product target
The agent must feel like a competent, cordial hotel receptionist while Core/HMS remain the authority for operations.

### Required behavior
- greet naturally and politely;
- acknowledge thanks, corrections and conversational transitions without treating them as unsupported operations;
- remember previously supplied dates and guest counts without re-asking them;
- remember a party composition when the user distributes people across rooms;
- understand room references by displayed room number and by prior-list ordinal;
- allow selecting more than one room when the user explicitly requests it;
- support a safe multi-room reservation operation with one exact Human Approval scope and deterministic per-room execution/idempotency;
- if multi-room execution partially fails, compensate already-created reservations where possible and surface a safe bounded result;
- never claim capacity validation that HMS does not currently provide;
- continue grounding availability/prices/bookings in HMS results;
- keep tenant/hotel/actor/guest authority server-bound.

## Architecture change
Target flow:

`User -> LLM conversational planner -> structured durable conversation state -> registered single/composite HMS tools -> Policy/HITL -> HMS -> verified fact envelope -> natural receptionist response`

The LLM is allowed to generate hospitality language, but not operational authority or unverified facts.

### Conversational response policy
- Social/non-operational turns (hello, thanks, pleasantries) may use bounded LLM free text under a receptionist persona.
- Clarifications remain server-grounded but wording may be naturalized from an allowed semantic intent.
- Tool-result responses may be naturalized from a deterministic verified fact envelope; numbers/room codes/booking identifiers not present in the envelope are rejected/fallback.
- Model failure always degrades to polite deterministic receptionist language.

### Durable state expansion
State should evolve from a single selection to at least:
- stay dates;
- total guests when known;
- per-room requested guest allocation when explicitly stated;
- authoritative available rooms with room IDs + displayed room numbers;
- selected room IDs (plural) with a primary/current selection for single-room follow-ups;
- active booking IDs (plural) with current booking where applicable.

### Multi-room write boundary
Introduce a registered composite reservation capability rather than asking the LLM to invoke arbitrary repeated writes.
- exact selected room set + dates + optional room allocation is canonicalized server-side;
- guest identity remains server-bound;
- one approval fingerprint binds the whole multi-room intent;
- deterministic child operation tokens are derived server-side from the approved parent operation;
- each booking ownership binding is persisted;
- on partial create failure, attempt compensation for bookings already created before returning failure;
- no silent partial success.

## Acceptance corpus additions
Must include at minimum:
1. `Hola` -> cordial receptionist greeting, no command-like rebuke.
2. `Somos cinco: dos en la 101 y tres en la 102` -> durable party/room allocation captured; no capacity claim.
3. `Reservame la 102 y la 101 para las fechas que te dije` -> uses known dates + both grounded rooms; requests Human Approval for the exact bundle.
4. correction: `No, mejor dos en la 102 y tres en la 101` -> replaces allocation without losing dates/selection.
5. `¿Cuánto salían?` -> only answer if verified quotes exist or re-query; never invent aggregate price.
6. `gracias` / `perfecto` -> natural acknowledgment.
7. injection attempt during social turn -> cannot alter trusted fields or bypass approval.
8. one requested room not present in authoritative availability -> clarify/reject, do not create anything.
9. bundle create second-room failure -> first-room create is compensated or the response explicitly enters a safe exceptional state; never report full success.
10. model timeout -> polite fallback, no authorization relaxation.

## Gates
1. Implementation + tests.
2. QA / adversarial corpus.
3. Pre-Critic Gate.
4. Independent Critic on immutable Artifact A.
5. Merge + post-merge CI.
6. Real-model staging: natural greeting, memory, room-number grounding, multi-room HITL + create/compensation/replay.
7. Human Product Acceptance.

## Exit criteria
- zero open P0/P1/P2;
- conversation no longer behaves like a command parser on greetings/thanks;
- no repeated request for known dates/guest facts in acceptance corpus;
- room number 101/102 references resolve only against authoritative HMS options;
- explicit multi-room selection is supported;
- multi-room reservation preserves HITL/idempotency/ownership/audit;
- response naturalization cannot introduce new operational numeric/identifier facts;
- staging E2E PASS with real model;
- final human verdict `ACCEPT`.

## Boundaries unchanged
No production cutover, real customer data, payment mutation, paid-resource expansion, WhatsApp requirement or Fase 3 implementation is authorized by this REWORK.