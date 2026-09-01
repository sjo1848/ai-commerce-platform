# ACP 2.6.9-R2.5 — QA Review

Status: `QA PASS — RECLOSED AFTER PRE-CRITIC REWORK`
Date: `2026-09-01`
PR: `#48`
Substage: `2.6.9-R2.5 — Multi-Room Reservation Orchestration`

## Original reviewed substantive boundary

`63029bf69c6c543986ab13071b0579fb278e45fe`

Verification on that boundary:
- core-ci `33456452748` / run #413: PASS
- unit/integration: `193/193 PASS`
- TypeScript/typecheck: PASS
- staging E2 runner syntax: PASS
- Wrangler dry-run: PASS

QA performed a separate adversarial grounding review instead of treating the green suite as sufficient.

## Finding 1 — P2 specific room cancellation depended on model-owned booking mapping

Original finding:
- server-owned reservation-group state persisted `activeBookingIds[]` but not the authoritative relation between each active booking and the room that produced it;
- an earlier test used a fake model that already emitted the correct internal `bookingId`;
- therefore `cancelá la habitación 101` was not proven to resolve without trusting model knowledge of hidden booking↔room identity.

Frozen failing regression:
- commit `eb854247f3cdec5b658321ba2c09fe581704e312`
- test `test/multi-room-specific-cancel-grounding-r2.5.test.mjs`

Rework:
- reservation-group state now persists server-owned `activeBookings[]` with `bookingId ↔ roomId ↔ roomNumber` grounding when known;
- mapping is created from authoritative execution result + exact approved room order;
- mapping remains hidden from model-visible conversation history and outside model `statePatch` authority;
- explicit room numbers and bounded ordinals resolve server-side before model-proposed booking IDs;
- unknown/ambiguous references clarify with no side effect.

Verification:
- commit `afe38ccbbdbeda4d777985210376758ec33ce3ba`
- core-ci `33458397571` / run #418: PASS
- `194/194 PASS`
- original P2 regression PASS.

Finding 1 status: `CLOSED`.

## Finding 2 — P1 stale explicit room reference could retarget the only remaining booking

During QA reclosure, the expanded corpus exposed a more serious edge case:
1. rooms 101 + 102 are active;
2. room 101 is cancelled successfully;
3. only room 102 remains;
4. user repeats `cancelá la habitación 101`;
5. the old routing order applied the single-active-booking shortcut before validating the explicit room reference, causing an approval challenge for the remaining booking 102.

This was a genuine wrong-target risk for an irreversible action and was treated as `P1`.

Frozen regression:
- commit `4f05006b243f81c2ed811810b245a0cdb54aeb85`
- run #419: expected failure
- suite result `196/197 PASS`, only the stale-reference P1 regression failed.

Rework:
- specific room/ordinal resolution now executes before the single-active-booking shortcut;
- explicit unknown/stale/ambiguous references fail closed to clarification even when only one different booking remains;
- the single-active-booking shortcut applies only when the cancellation request is generic and does not contradict server-owned grounding;
- whole-group language with one remaining booking still resolves safely to that booking.

Verification boundary:
- commit `d17b765e787b9553ae28a37d87342b29d13f0a11`
- core-ci `33458742389` / run #420: PASS
- `197/197 PASS`
- TypeScript/typecheck: PASS
- staging E2 runner syntax: PASS
- Wrangler dry-run: PASS.

Finding 2 status: `CLOSED`.

## Finding 3 — P2 Core idempotency result was not session-bound

The subsequent Pre-Critic architecture review found a coherence gap between Core idempotency and the already session-bound approval/ownership model.

Original finding:
- Core idempotency records stored tenant, actor, tool, fingerprint and result, but not `sessionId`;
- a same-tenant/same-actor request could reuse the same client idempotency key and exact payload from another session and receive the cached side-effect result from the original session;
- reservation ownership remained bound to the original session, so this did not authorize an ownership bypass, but it could migrate booking IDs / composite outcome into a session that did not own those bookings and create inconsistent reservation-group grounding.

Frozen failing regression:
- commit `94db6bab47a7fc2d193ab50ba588012c6816e30d`
- test `same actor cannot replay a Core-idempotent result into another session` in `test/idempotency.test.mjs`
- core-ci `33460043489` / run #423: expected failure
- suite result `197/198 PASS`; the new cross-session isolation regression was the only failure.

Rework:
- `IdempotencyRecord` now persists trusted `sessionId`;
- Core replay validates exact tenant + actor + session + tool + canonical fingerprint;
- reuse of the same key from another session returns `IDEMPOTENCY_CONFLICT`;
- the conflicting request does not execute a duplicate side effect;
- the external key format remains tenant-prefixed, preserving conflict detection rather than silently creating a second operation under a session-prefixed key.

Implementation commits:
- `2a3fca98cb07d57682da47e546ddb504b5efdd94` — persist session binding in Core idempotency records;
- `f5b2c3313e2ac5e97d820ea67fa4dcd74e184b0b` — reject cross-session replay and store session ID on success.

Verification boundary:
- substantive Artifact A candidate `f5b2c3313e2ac5e97d820ea67fa4dcd74e184b0b`
- core-ci `33460108417` / run #425: PASS
- `198/198 PASS`
- TypeScript/typecheck: PASS
- staging E2 runner syntax: PASS
- Wrangler dry-run: PASS
- cross-session idempotency regression: PASS.

Finding 3 status: `CLOSED`.

## Reclosure adversarial corpus

The QA reclosure now proves:
- `cancelá la habitación 101` resolves from server-owned booking↔room grounding while ignoring a forged/unknown model booking ID;
- `cancelá la primera` resolves from canonical active-group order server-side;
- `cancelá la habitación 999` clarifies with no approval and no side effect;
- after 101 is cancelled, repeating `cancelá la habitación 101` cannot silently target remaining room 102;
- same actor + tenant cannot replay a Core-idempotent side-effect result from another session;
- cross-session idempotency conflict does not execute a duplicate side effect;
- exact human approval is still required before every irreversible cancellation;
- group cancellation, ownership, compensation, timeout/recovery and prior R2.4 regressions remain green.

The R2.5 contract must freeze both cancellation-grounding and session-scoped idempotency invariants before the fresh Pre-Critic artifact is issued.

## Severity gate

Open P0: `0`
Open P1: `0`
Open P2: `0`

QA verdict: `PASS / RECLOSED AFTER PRE-CRITIC REWORK`.

A fresh exact-head CI containing this QA revalidation and the updated contract is required before Pre-Critic can close. Independent Critic, staging validation, merge and R2.6 remain blocked until their own gates complete.
