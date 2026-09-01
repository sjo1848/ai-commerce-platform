# ACP 2.6.9-R2.5 — Multi-Room Reservation Orchestration

Status: `AUTHORIZED / ACTIVE`
Date: `2026-08-31`
Parent: `ACP-2.6.9-R2-NATURAL-RECEPTIONIST`
Base: `main@29ecc42c870c77cc86b0e65c3366f52c6c735743`

## Goal

Convert the authoritative multi-room conversational state closed in R2.4 into controlled HMS reservation and cancellation execution without weakening Policy, HITL, exact-plan binding, idempotency, ownership, auditability or HMS source-of-truth authority.

R2.5 is an execution substage. It does not authorize production cutover, payments, broader autonomous writes, paid-resource expansion, WhatsApp as a requirement or a second vertical.

## Architecture decision

Multi-room execution is an HMS adapter capability, not generic Core business logic.

Core remains responsible for generic governance:
- Tool Registry visibility;
- Policy Engine;
- human approval;
- canonical validation before fingerprinting;
- exact stored ToolPlan execution after approval;
- Core-level idempotency for composite orchestration;
- audit and usage.

The HMS adapter is responsible for domain orchestration:
- executing child HMS reservation calls;
- deriving child operation tokens server-side from the trusted group idempotency key;
- binding ownership for each successful child reservation;
- compensating already-created children when a later child fails;
- executing group cancellation from server-grounded booking IDs;
- reporting partial outcomes explicitly.

The LLM never receives authority to author child operation tokens, approval metadata, guest identity, tenant/hotel routing, ownership or idempotency.

## Required tools

### `hms.createMultiReservation`

Canonical server-validated input:
- `roomIds`: 2–10 unique room IDs, overridden from the current canonical `selectedRoomIds[]`;
- optional server-grounded display room numbers for approval UX;
- `checkIn` / `checkOut` from durable stay state;
- optional notes;
- trusted `guestId` injected from tenant+actor mapping before fingerprinting.

Policy:
- primitive `RESERVE`;
- write / reversible;
- human approval required;
- composite orchestration uses Core idempotency at group level.

Initial execution:
1. Require a trusted root idempotency key.
2. Derive deterministic child create tokens server-side; model/user cannot provide them.
3. Create rooms sequentially so failure boundaries are deterministic and auditable.
4. Perform a fresh aggregate HMS availability preflight before the composite starts.
5. Immediately before each child create, re-read transactional HMS availability for the exact approved dates and require that exact child room to remain available.
6. Bind each successful booking to its original child create token before proceeding.
7. If a child create, fresh availability gate or ownership bind fails, stop creating further rooms.
8. Attempt compensation for every prior successful child using its original trusted create token when the current failure is definitive.
9. Return a structured authoritative outcome; never claim atomicity.

Trusted recovery execution after `OUTCOME_UNKNOWN` is deliberately different:
- do **not** repeat aggregate or per-child availability preflights;
- replay the exact stored ToolPlan with the same root idempotency key and therefore the same deterministic child tokens;
- an already-committed child may correctly be absent from availability because this same operation now occupies the room, so availability is not authoritative for distinguishing self-commit from third-party conflict during recovery;
- HMS downstream idempotency is authoritative for an already-committed child and must return its replayed result;
- a child that never committed still goes through HMS transactional create semantics and may definitively conflict if the room became unavailable;
- recovery mode is entered only from trusted server-owned approval state (`recoveryAttempt > 0`), never from model/request input.

Allowed outcomes:
- `confirmed`: every child confirmed; all booking IDs become current active group bookings.
- `compensated`: group creation failed, but every already-created child was successfully cancelled; no active group bookings remain.
- `compensation_failed`: group creation failed and one or more successful children could not be compensated; remaining booking IDs stay explicitly active/owned for follow-up cancellation.

### `hms.cancelMultiReservation`

Canonical server-grounded input:
- `bookingIds`: 2–10 current active booking IDs supplied by server state, never reconstructed from prose.

Policy:
- primitive `CANCEL`;
- write / irreversible;
- human approval required;
- Core idempotency at group-cancellation level.

Execution:
- ownership is verified independently for every booking before any downstream cancellation starts;
- if any booking is not owned by the trusted session/tenant/actor, fail closed before the first cancellation;
- trusted ownership/token binding is re-read immediately before each irreversible child cancellation;
- cancellations execute deterministically;
- partial downstream cancellation failure is reported explicitly because cancellation cannot be safely compensated by silently re-creating reservations.

Allowed outcomes:
- `cancelled`: every requested booking cancelled; no active group bookings remain.
- `partial_failure`: some cancellations succeeded and some failed; failed booking IDs remain explicitly active for follow-up.

## Exact human confirmation gate

Before any multi-room mutation, the 409 approval challenge must include one server-produced exact summary derived from the validated stored plan.

Create summary must contain at minimum:
- action: reserve several rooms;
- exact room references available in the canonical plan;
- exact check-in/check-out;
- room count.

Cancel-all summary must contain at minimum:
- action: cancel several bookings;
- exact booking count and booking IDs or equivalent server-grounded references.

The approval token remains bound to:
- trusted session/tenant/actor;
- original user message;
- root idempotency key;
- exact operation fingerprint;
- exact canonical ToolPlan.

Approval consumption executes that stored plan without another model routing pass.

## Core idempotency scope

Core-idempotent side-effect results are part of the trusted operational boundary and must use the same scope as approval and ownership.

Invariants:
- a completed Core-idempotent result may replay only for the exact trusted `tenantId + actorId + sessionId + toolId + canonical input fingerprint` that produced it;
- reusing the same client idempotency key in another session, even for the same tenant, actor, tool and payload, returns `IDEMPOTENCY_CONFLICT`;
- a cross-session conflict must not execute a second side effect and must not migrate cached booking IDs, group outcomes or reservation grounding into the new session;
- the idempotency key remains tenant-prefixed rather than session-prefixed so cross-session reuse is detected as a conflict instead of silently becoming a second operation;
- downstream child idempotency tokens remain deterministically derived from the trusted root key and are never model/request-authored;
- approval, Core idempotency and reservation ownership therefore converge on the same session boundary.

## Conversation state

Server-owned booking grounding is extended to support a group:
- canonical `activeBookingIds[]`;
- authoritative internal `activeBookings[]` entries preserving `bookingId ↔ roomId ↔ roomNumber` whenever known;
- legacy `activeBookingId` only as compatibility alias when exactly one active booking remains;
- `bookingStatus` remains a compact group/lifecycle status;
- `bookingStateRevision` protects group state from stale/concurrent rollback.

The internal booking↔room mapping is server-owned evidence. It is stored only in the hidden reservation-group state, is excluded from model-visible conversation history, and cannot be authored, cleared or replaced through model `statePatch`.

Tool results plus the exact approved room order, not model prose, create and update the booking↔room mapping. Successful single/group cancellation removes the corresponding mapping immediately.

## One vs all cancellation

- explicit single-booking cancellation continues through `hms.cancelReservation` and removes only that booking from the canonical active group;
- clear all/group cancellation routes `hms.cancelMultiReservation` with server-grounded `activeBookingIds[]` when several active bookings remain;
- explicit room-number references such as `cancelá la habitación 101` are resolved server-side against the active booking↔room mapping before any model-proposed booking ID is considered;
- bounded ordinals such as `la primera` / `la segunda` are resolved server-side in the current canonical active-group order;
- an explicit unknown, stale or ambiguous room/ordinal reference fails closed to clarification and produces no approval or side effect;
- the shortcut `there is exactly one active booking, therefore cancel it` is valid only for a generic cancellation request with no contradictory explicit room/ordinal reference;
- a stale explicit room reference can never silently retarget the only remaining booking;
- ambiguous cancellation requests ask whether the guest means one booking/room or the whole group; no arbitrary scope selection.

## Grounding invariants

- `hms.createMultiReservation.roomIds` are always overwritten from canonical R2.4 selected rooms before validation/fingerprinting;
- multi-room creation requires at least 2 selected canonical rooms;
- selected rooms must remain within current HMS availability candidates before approval and on initial execution;
- unresolved R2.4 room/occupancy issues block execution before approval;
- dates come from durable semantic state and override model-proposed dates;
- trusted guest identity is server-injected;
- booking IDs for group cancellation come from server-owned booking state;
- booking↔room grounding for specific cancellation comes from server-owned execution evidence, never from model inference;
- an explicit user room/ordinal reference has precedence over a model-proposed booking ID and over the single-remaining-booking fallback;
- unknown/stale explicit references are clarification-only and must not mutate the remaining group;
- model/user cannot inject trusted metadata, recovery depth or child tokens.

## Partial-failure semantics

The implementation must never represent a multi-step sequence as atomic unless the downstream system provides real atomicity. HMS currently exposes single-reservation primitives, so R2.5 must expose orchestration outcomes honestly.

Required evidence for failure tests:
- fail before first child => no compensation required, no active booking;
- fail after one child => compensation succeeds => `compensated`;
- fail after one child => compensation fails => `compensation_failed`, surviving booking remains owned/active;
- replay of an already completed composite operation returns the same Core-idempotent outcome without duplicate child side effects;
- group cancellation verifies ownership for every booking before first mutation;
- cancellation partial failure leaves only failed booking IDs active.

## Timeout / uncertain-result semantics

A thrown RPC/transport exception after dispatch is not proof that HMS rejected a mutation. R2.5 therefore distinguishes authoritative failures from uncertain transport outcomes.

Rules:
- a structured HMS error response is authoritative and is not retried by this reconciliation layer;
- when a mutating HMS RPC throws before a result is observed, replay it exactly once with the same downstream idempotency token;
- a definitive replay result becomes authoritative and normal execution may continue;
- if the exact-token replay also throws, raise `OUTCOME_UNKNOWN` with HTTP 503;
- after `OUTCOME_UNKNOWN`, do not start later child mutations and do not speculate that the uncertain mutation succeeded or failed;
- an uncertain compensation is also `OUTCOME_UNKNOWN`; it must never be represented as `compensated` or `compensation_failed` without an authoritative result;
- Core does not cache an `OUTCOME_UNKNOWN` exception as a completed composite result, so the exact operation remains replayable;
- webchat recovery must preserve the already-approved exact ToolPlan, original message, root idempotency key and operation fingerprint, issue a fresh single-use recovery challenge, and never reroute the model;
- recovery depth is trusted server-owned approval state persisted with the challenge; request/model input cannot set, reset or decrement it;
- at most 3 recovery approval challenges are allowed after the original approved execution; if the outcome remains unknown after the third recovery, automatic recovery stops and manual reconciliation is required;
- recovery with the same root idempotency key deterministically derives the same child tokens, allowing HMS downstream idempotency to reconcile any mutation that may already have committed;
- recovery availability checks must not run before exact-token child replay, because this operation's own successful-but-unobserved commits may have removed those rooms from availability; exact-token downstream replay plus transactional create/conflict semantics are the authority in recovery mode.

## Backward compatibility

R2.5 must not regress:
- single-room reservation/cancellation;
- single-room exact approval flow;
- durable semantic memory;
- R2.4 room selection/clarification;
- tenant/actor/session isolation;
- Policy/HITL;
- approval fingerprinting and single-use approval challenge;
- downstream original-token cancellation semantics for single bookings;
- provider/model trust boundary.

## Required QA corpus

At minimum freeze tests for:
1. exact two-room plan requests one approval, not two approvals;
2. approval summary matches exact rooms + dates;
3. approved group plan executes without model reroute;
4. child tokens are deterministic server-derived and absent from model/request input;
5. group-level idempotency prevents duplicate child side effects;
6. successful two-room create stores two active booking IDs;
7. partial create + successful compensation leaves zero active bookings;
8. partial create + failed compensation leaves surviving owned booking active;
9. all-group cancellation requires approval and pre-verifies ownership of every booking;
10. successful group cancel clears active booking IDs;
11. partial group cancel retains failed booking IDs only;
12. single-booking cancel from a group removes only that booking;
13. forged booking IDs / guest identity / operationToken / approval metadata fail closed;
14. stale state cannot resurrect cancelled group bookings;
15. R2.4 165-test baseline plus all prior security regressions remain green;
16. initial execution revalidates room availability immediately before every child create, not only once before the group;
17. one uncertain create/cancel response is reconciled by exact-token replay;
18. repeated transport uncertainty returns `OUTCOME_UNKNOWN` and stops later child mutations;
19. uncertain compensation never produces a guessed lifecycle outcome;
20. recovery after `OUTCOME_UNKNOWN` executes the same stored ToolPlan with the same root idempotency key and no model reroute;
21. forged client recovery counters cannot reset the server-owned recovery depth, and recovery exhausts after the third challenge;
22. realistic recovery succeeds when this operation's already-committed children have disappeared from availability, by replaying the exact child tokens without recovery availability preflight;
23. `cancelá la habitación 101` resolves from server-owned booking↔room grounding even when the model proposes an unknown/forged booking ID;
24. bounded ordinal cancellation (`la primera`) resolves server-side without model booking authority;
25. an unknown room such as `999` clarifies with no approval and no side effect;
26. after room `101` was cancelled, repeating an explicit `cancelá la habitación 101` cannot retarget the only remaining booking;
27. same tenant + actor + tool + payload + client idempotency key from a different session returns `IDEMPOTENCY_CONFLICT`, does not replay the prior result into that session, and does not execute a second side effect.

## Exit gate

R2.5 closes only after:
- implementation complete on a dedicated branch/PR;
- full QA and all new regressions PASS;
- exact-head CI PASS;
- zero open P0/P1/P2;
- Pre-Critic PASS;
- fresh Independent Critic PASS;
- merge to main;
- post-merge main CI PASS;
- GitHub state, Drive tracker and vault converge.

Only then may R2.6 become active.
