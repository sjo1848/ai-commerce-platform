# ACP 2.6.9-R2.5 — QA Review

Status: `QA PASS — RECLOSED`
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

## Reclosure adversarial corpus

The QA reclosure now proves:
- `cancelá la habitación 101` resolves from server-owned booking↔room grounding while ignoring a forged/unknown model booking ID;
- `cancelá la primera` resolves from canonical active-group order server-side;
- `cancelá la habitación 999` clarifies with no approval and no side effect;
- after 101 is cancelled, repeating `cancelá la habitación 101` cannot silently target remaining room 102;
- exact human approval is still required before every irreversible cancellation;
- group cancellation, ownership, idempotency, compensation, timeout/recovery and prior R2.4 regressions remain green.

The contract was updated in `7696ae6c5d4f112b7934698b1310ad6a51199e89` to freeze the booking↔room and stale-reference invariants.

## Severity gate

Open P0: `0`
Open P1: `0`
Open P2: `0`

QA verdict: `PASS / RECLOSED`.

Pre-Critic may begin only after the PR-head CI containing this QA reclosure artifact and the updated contract is green. Independent Critic, staging validation, merge and R2.6 remain blocked until their own gates complete.
