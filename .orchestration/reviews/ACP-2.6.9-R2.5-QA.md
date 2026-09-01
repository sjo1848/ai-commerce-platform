# ACP 2.6.9-R2.5 — QA Review

Status: `QA REWORK — P2 OPEN`
Date: `2026-09-01`
PR: `#48`
Substage: `2.6.9-R2.5 — Multi-Room Reservation Orchestration`

## Reviewed substantive boundary

`63029bf69c6c543986ab13071b0579fb278e45fe`

Verification on that boundary:
- core-ci `33456452748` / run #413: PASS
- unit/integration: `193/193 PASS`
- TypeScript/typecheck: PASS
- staging E2 runner syntax: PASS
- Wrangler dry-run: PASS

QA then performed a separate adversarial grounding review instead of treating the green suite as sufficient.

## QA finding

### P2 — specific room cancellation depends on model-owned booking mapping

Finding:
- the server-owned reservation-group state currently persists `activeBookingIds[]`, but not the authoritative relation between each active booking and the room that produced it;
- the existing R2.5 test for `cancelá la primera reserva` / room `101` uses a fake model that already emits the correct internal `bookingId`;
- that test therefore proves the allowlist check around a model-proposed booking ID, but it does **not** prove that a natural human room reference can be resolved without trusting the model to know the hidden booking↔room relation;
- a real model may see conversation/tool history, but inference from ordering/history is not an acceptable authority boundary for an irreversible cancellation.

Risk:
- no unauthorized cancellation occurs: the current implementation fails closed when the model-proposed booking ID is not one of the active server-owned bookings;
- however, a valid request such as `cancelá la habitación 101` can degrade to ambiguity even though the server has enough information at reservation time to preserve the mapping;
- this violates the intended `one room/booking vs whole group` receptionist behavior and leaves a grounding gap in the cancellation UX.

Severity: `P2` (functional/grounding gap, fail-closed safety preserved).

## Frozen failing regression

Commit:

`eb854247f3cdec5b658321ba2c09fe581704e312`

Test:

`test/multi-room-specific-cancel-grounding-r2.5.test.mjs`

The regression deliberately makes the model propose an unknown/attacker booking while the user says:

`cancelá la habitación 101`

Expected behavior:
- Core resolves room `101` against server-owned reservation-group grounding;
- Core selects the exact corresponding booking;
- one exact approval challenge is issued;
- no side effect occurs before approval;
- the other room/booking is not included.

The current implementation is expected to fail this regression by asking for clarification rather than resolving the known room reference.

## Required rework

1. Persist authoritative booking↔room grounding for active multi-room bookings, not only booking IDs.
2. Keep that grounding server-owned and hidden from model statePatch authority.
3. Resolve explicit room-number and bounded ordinal references server-side during single cancellation from a group.
4. Never infer the mapping from model prose or model-provided booking IDs.
5. Preserve current fail-closed behavior when the reference is unknown or ambiguous.
6. Keep group cancellation and existing exact-booking cancellation semantics unchanged.
7. Add regressions for at least:
   - `cancelá la habitación 101`;
   - `cancelá la primera`;
   - unknown room number => clarification/no side effect;
   - forged model booking ID ignored when a valid room reference exists;
   - stale/cancelled mapping cannot be resurrected.

## Severity gate

Open P0: `0`
Open P1: `0`
Open P2: `1`

QA verdict: `REWORK`.

Pre-Critic and Independent Critic remain blocked until this finding is fixed, the adversarial regression turns green, full exact-head CI passes, and QA is reclosed with P0/P1/P2 = `0/0/0`.
