# ACP 2.6.9 — Human Product Acceptance REWORK — Technical Closure

Date: 2026-08-30
Status: `TECHNICAL_PASS / HUMAN_GATE`

## Why 2.6.9 was reopened

The first Human Product Acceptance did not pass. Free-form human testing exposed that the agent could use Workers AI but still lose important multi-turn context: dates and guest count could be asked again after the user had already provided them. This was accepted as a real product finding and 2.6.9 moved to `REWORK` rather than being auto-accepted.

The subsequent real-model staging cycles exposed two additional conversational gaps:

1. ordinal references such as `¿Cuánto sale la primera?` were not reliably grounded to the ordered HMS availability result;
2. an LLM tool plan with a truly missing required business field could reach canonical tool validation and return HTTP 400 instead of asking only for the unresolved information.

## Implemented correction

The REWORK now provides structured, durable conversation state per session for:

- stay check-in/check-out;
- guest count;
- authoritative HMS availability candidate IDs in returned order;
- selected room;
- active booking and booking status.

The LLM remains responsible for natural-language interpretation. The server remains authoritative for state, tool visibility and execution.

Additional invariants added during REWORK:

- internal conversation-state snapshots never enter model-visible history;
- a model-selected room ID is accepted only when it belongs to the authoritative HMS candidate set;
- ordinal references are emitted as a one-based `selectedRoomIndex`; Core resolves that index against the HMS candidate order;
- an out-of-range ordinal clears a stale prior selection instead of silently reusing it;
- dates/guests/room/booking facts already present in durable state are reused rather than requested again;
- after state enrichment, truly absent model-visible required business fields become deterministic clarifications before Policy/Executor;
- present-but-invalid values are not downgraded to clarifications and still fail canonical validation;
- no trusted tenant/hotel/actor/guest/approval/idempotency authority was added to the model.

## Final Artifact A

Final substantive Artifact A:

`9ec9f062dfdc8ad9a73bb2646338d932b77c4c19`

Artifact CI:

- core-ci `33322906416` — `PASS`;
- 84 tests — `84/84 PASS`;
- typecheck — `PASS`;
- staging E2E runner syntax — `PASS`;
- Cloudflare Worker dry-run/config — `PASS`.

Independent Critic on PR #38: `PASS` with no blocking P0/P1/P2.

Integration:

`38ed24aa272e9e75e1ee0a62c0dab37019a5b408`

Post-merge core-ci:

`33322945318` — `PASS`.

## Final real-model staging evidence

Acceptance/staging head:

`aa8f2ae1562cb67094714efb5cfeb29777c843ec`

Deploy workflow:

`33322986328` — `PASS`.

The final deployment passed all required gates:

- Foundation regression — `PASS`;
- E1 natural same-session availability + ordinal quote — `PASS`;
- expanded real Workers AI conversational evaluator — `PASS`;
- the previously failing date-only/guest clarification path — `PASS`;
- the previously failing prior-date reservation continuation path — `PASS`;
- controlled reservation/cancellation E2 — `PASS`;
- HITL before writes — `PASS`;
- idempotency/ownership semantics — `PASS`;
- inventory restoration after cancellation — `PASS`;
- staging handoff — `PASS`.

## Technical verdict

`2.6.9 REWORK TECHNICAL_PASS`

No known P0/P1/P2 remains open inside the bounded REWORK scope. The automated, QA, Independent Critic, integration and staging gates are closed.

This is not Product Acceptance. The next and only authorized gate is a new Human Product Acceptance using free-form conversation.

Required human verdicts:

- `ACCEPT` — closes Phase 2.6 as `PRODUCT_ACCEPTED` and allows Fase 3 — Alquileres to begin under the same Core architecture;
- `REWORK` — reopens only the concrete product findings observed in human testing and repeats the bounded method cycle.

## Boundaries still in force

While this Human Gate is open:

- production cutover is not authorized;
- real customer data is not authorized;
- payment mutation is not authorized;
- paid-resource expansion is not authorized;
- WhatsApp is not a requirement;
- Fase 3 — Alquileres remains blocked;
- the Controller must not self-approve Product Acceptance.
