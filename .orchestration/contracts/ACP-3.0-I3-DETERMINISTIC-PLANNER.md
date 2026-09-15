# ACP-3.0 I3 — HotelTaskDefinition + Deterministic Planner

Status: IMPLEMENTATION CANDIDATE / GATE OPEN
Date: 2026-09-15
Base: I2 exact PASS SHA `3474ca4a7007516ecc23ca9f50c96741736127d3`
Branch: `feature/acp-3.0-i3-deterministic-planner`

## Scope

Implement the approved ACP-3.0.4 deterministic planning boundary without runtime integration.

Pipeline in scope:

`post-reducer/post-grounding TaskState + PlanningTrigger + HotelTaskDefinition + DomainCapabilities -> exactly one NextStep`

No raw user text enters Planner.

## Real HMS capability evidence

I3 is bound to the existing agent-facing HMS contracts, not conceptual names:

- `availability` -> `hms.checkAvailability` — read — `{ checkIn, checkOut, guests }`
- `quote` -> `hms.getQuote` — read — `{ roomId, checkIn, checkOut }`
- `reserve_single` -> `hms.createReservation` — write — server-authenticated guest identity + grounded `{ roomId, checkIn, checkOut }`
- `reserve_multi` -> `hms.createMultiReservation` — write — server-grounded `{ roomIds, checkIn, checkOut }`
- `cancel_single` -> `hms.cancelReservation` — write — `{ bookingId }`
- `cancel_multi` -> `hms.cancelMultiReservation` — write — server-grounded booking set

There is no current HMS agent tool for booking lookup/list or booking modification. Planner v1 must not invent either capability and must not synthesize modification as cancel+create.

The current multi-room tool does not consume occupancy; occupancy therefore cannot be introduced as a mandatory Planner prerequisite merely because it appeared in an earlier conceptual workflow.

## Boundaries

Planner MAY:
- detect missing business facts from TaskState;
- reuse current validated observations;
- request an enabled declared capability;
- emit ASK, CALL_TOOL, RESPOND, WAIT, COMPLETE or DEGRADE;
- compute deterministic causal precondition fingerprints from bounded state projections.

Planner MUST NOT:
- parse or classify raw language;
- resolve symbolic/contextual references;
- invent room/booking IDs or operational facts;
- read raw HMS/provider payloads;
- choose from raw ToolRegistry dynamically;
- decide actor authorization or HITL approval;
- execute tools or generate idempotency tokens;
- resume an approved PreparedOperation through a new mutation plan;
- generate conversational prose;
- split unsupported multi-room work into several writes;
- synthesize modify as cancel+create.

## DomainCapabilities

`DomainCapabilities` is a semantic server-provided technical capability view. It is not Policy output and is not actor authorization.

Bindings must match the exact `HotelTaskDefinition` contract identity. A tampered/mismatched capability view fails closed.

## Fingerprints

Every CALL_TOOL has a canonical SHA-256 `preconditionFingerprint` over:
- Planner contract identity;
- TaskDefinition contract identity;
- capability contract identity and capabilityId;
- bounded causal dependency projection for that requested action.

Global `stateRevision` is not used as semantic freshness.

## Decision rules

1. Terminal lifecycle first.
2. Explicit abort/interaction/retry/read/show directives before background/pending work.
3. Blocking semantic ambiguity/missing facts.
4. Acquire needed operational truth via a declared read capability.
5. Require server-grounded references for room/booking targets.
6. Never turn goal into write commit; explicit `operationIntent` is required.
7. Propose a declared native write capability only when grounded prerequisites exist.
8. Approval/pending operation waits only when no newer explicit read/social directive must be handled.
9. No booking lookup or modify capability is fabricated.
10. Same PlanningContext yields the same NextStep.

## I3 test gate

Focused tests must cover at minimum:
- real capability IDs/absence of lookup+modify;
- full J01 synthetic Planner progression;
- all stay facts supplied at once;
- no redundant availability;
- empty availability;
- matching pending read vs superseded pending;
- no Planner-side reference resolution;
- native multi-room reserve and capability-unavailable degradation;
- approval pending plus lateral read;
- cancellation grounding and absence of lookup;
- modification unsupported;
- bounded retry and Core-owned write recovery;
- social/ack while business work pending;
- deterministic output/fingerprint;
- capability-view tampering fail-closed.

## Non-goals

- no orchestrator/runtime wiring;
- no Core/Executor changes;
- no provider/model calls;
- no HMS reads/writes;
- no deployment;
- no Response Composer;
- no second vertical.

Gate remains open until exact-head `core-ci` and adversarial implementation review both pass.
