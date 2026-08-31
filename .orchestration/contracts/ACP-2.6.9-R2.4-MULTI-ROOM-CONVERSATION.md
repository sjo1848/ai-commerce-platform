# ACP 2.6.9-R2.4 — Multi-Room Conversation Model

Status: `AUTHORIZED / ACTIVE`
Date: `2026-08-31`
Parent: `ACP-2.6.9-R2-NATURAL-RECEPTIONIST`
Base: `main@3de60dd98201214a9cd62f3ea631c6cafce78c22`

## Goal
Represent, ground and preserve what a competent hotel receptionist understands when the guest discusses several rooms, without introducing multi-room side effects yet.

R2.4 is a conversation/state substage. Multi-room reservation execution, exact multi-operation approval binding, compensation and multi-booking cancellation remain exclusively R2.5.

## Product cases frozen from the R2.1 corpus
R2.4 must cover at minimum:

- `MR-101`: `Quiero la 101 y la 102` -> both rooms selected, both grounded in the current HMS candidate set, never collapsed to one room.
- `MR-102`: `Me quedo con las dos primeras` -> ordinals 1 + 2 resolve server-side against the authoritative availability order.
- `MR-103`: `La 101 para dos y la 102 para tres` with total guests 5 -> room-level occupancy is preserved and totals agree.
- `MR-104`: `Quiero la 101 y la 102` then `Mejor cambiá la 102 por la 103` -> final set is 101 + 103 and 102 is removed.
- `CLR-101`: known dates + known guests + `Quiero dos habitaciones` -> remember requested room count but ask which rooms/preferences; do not ask dates or guests again.
- `CLR-102`: total guests 5 + allocations 101=2 and 102=2 -> natural occupancy clarification; never silently invent the fifth guest allocation.
- `CLR-103`: three candidates + `Reservame dos` -> remember room count 2 and ask which rooms; never choose two arbitrarily.
- `ADV-102`: any room number/ID not present in the current HMS candidate set is rejected as grounding and cannot enter canonical selection.

## Canonical state model
The server owns canonical room grounding.

Required representation:

- authoritative availability candidates containing at least `id` and `roomNumber` when HMS provides it;
- ordered `selectedRoomIds[]` as the canonical selected room set;
- legacy `selectedRoomId` remains only as a compatibility alias when exactly one room is selected;
- `requestedRoomCount` for statements such as `quiero dos habitaciones` before exact rooms are known;
- room-level occupancy entries keyed internally by authoritative `roomId`;
- a room-selection revision separate from semantic stay-memory and booking-state revisions so concurrent/stale snapshots cannot roll back room selection.

## Model-write boundary
The LLM may propose only bounded room references:

- exact candidate room numbers;
- one-based ordinals into the current candidate list;
- exact room IDs already exposed in the candidate set;
- requested room count;
- explicit room occupancy counts.

Core resolves those references against current HMS candidates. Unknown, stale or out-of-range references cannot become canonical room IDs.

The model cannot author:

- a room outside the candidate set;
- tenant/hotel/actor/trusted context;
- booking IDs or approval metadata;
- multi-room execution plans or operation tokens;
- silent occupancy assumptions.

## Compatibility and execution safety
Single-room behavior must remain backward compatible.

For quote/reservation tool enrichment:

- exactly one canonical selected room may populate `roomId`;
- more than one selected room MUST NOT be collapsed into a single `roomId`;
- a multi-room reservation request is conversation-only in R2.4 and cannot execute `hms.createReservation` until R2.5 defines exact-plan semantics.

A change to stay dates or total guests invalidates stale availability/room grounding while preserving independently stated requested room count where safe.

## Occupancy rules
Occupancy is optional until the user supplies it or an operation requires disambiguation.

If occupancy is supplied:

- every allocation must resolve to a selected HMS candidate;
- no room may appear twice after canonicalization;
- each allocation must contain a positive bounded guest count;
- when total party guests are known and all selected rooms are allocated, the allocation sum must equal total guests;
- partial or inconsistent allocation is clarification-worthy and must never be completed by assumption.

## Exit gate
R2.4 may close only when:

1. exact numbers `101 + 102` resolve and persist as two canonical rooms;
2. ordinals `las dos primeras` resolve server-side;
3. replacement `102 -> 103` changes only the intended selection;
4. requested count without exact rooms causes bounded selection clarification;
5. consistent occupancy persists; inconsistent occupancy causes an occupancy clarification;
6. unknown room numbers/IDs and out-of-range ordinals fail closed;
7. stale/concurrent state cannot restore an older room selection;
8. single-room quote/reservation regressions remain green;
9. multi-room reservation execution remains blocked in R2.4;
10. full QA/typecheck/tests/Worker dry-run PASS;
11. QA + Pre-Critic + Independent Critic return `P0/P1/P2 = 0/0/0`;
12. merge + post-merge main regression PASS and tracker/state convergence complete.

## Boundaries
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, multi-room side effects, R2.5 execution work, or second vertical is authorized in R2.4.
