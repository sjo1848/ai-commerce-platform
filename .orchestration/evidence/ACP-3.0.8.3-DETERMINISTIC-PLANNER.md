# ACP-3.0.8.3 — Hotel TaskDefinition + Deterministic Planner Evidence

Status: `FINAL CANDIDATE / EXACT-HEAD CI PENDING`

## Prerequisite gate

`ACP-3.0.8.2 DETERMINISTIC_REDUCER_PASS`
- exact head `5860202068eb89cce8f7b0e37d5e5dbc4225e987`
- core-ci #643 / `34755757781` PASS

## Implemented contracts

- `HotelTaskDefinition` v1 declares deterministic HMS bindings, required facts and dependency keys.
- `DomainCapabilities` is built server-side from visible tool IDs and does not encode final actor authorization or Policy outcome.
- capability preconditions use a stable deterministic fingerprint over TaskDefinition identity, capability contract, dependency keys and a canonical dependency projection.
- `PlanningTrigger` contains only structured immediate directives/cause; durable semantics remain in reduced TaskState.
- `NextStep` is exactly one of ASK, CALL_TOOL, RESPOND, WAIT, COMPLETE or DEGRADE.
- every CALL_TOOL contains grounded input and a precondition fingerprint.
- Planner contains no raw-text parsing, regex/NLU, date normalization, policy decision, approval decision, side-effect execution or final response prose.

## Real HMS capability alignment

Bindings verified against current adapters:
- availability -> `hms.checkAvailability`
- quote -> `hms.getQuote`
- reserve single -> `hms.createReservation`
- reserve multi -> `hms.createMultiReservation`
- cancel single -> `hms.cancelReservation`
- cancel multi -> `hms.cancelMultiReservation`
- native modify -> absent in current visible adapter set

The actual multi-reservation contract requires server-grounded roomIds/checkIn/checkOut and does not require per-room occupancy input.

## Adversarial findings closed before push

1. Reservation precondition originally omitted `operationIntent`. Closed: reserve dependency keys and projection now include the current commit semantics, so withdrawing/changing commit changes or removes the write precondition.
2. TaskDefinition originally carried bindings only. Closed: v1 explicitly declares required facts and dependency keys; these are also copied into DomainCapabilities and fingerprint identity.
3. Multi-room without native composite capability never decomposes into multiple single-room writes; it degrades unsupported.
4. Approval pending does not freeze an explicit read request; read directive is handled before passive approval WAIT.
5. Tool failures do not auto-retry. Retry is explicit and write retry remains control-plane owned.
6. `rooms=[]` is a valid availability observation and produces grounded no-availability response, not failure.
7. Knowledge requests do not create implicit RAG/tool behavior when no declared capability exists.

## Booking grounding carry-forward

TaskState currently contains user-owned `bookingReference` and tool-authoritative `bookings[]`, but no explicit server-owned `groundedBookingTarget` receipt. Design requires reference grounding outside the Planner.

Therefore cancellation/modification deliberately return `BOOKING_TARGET_GROUNDING_REQUIRED` instead of matching user references to bookings inside the Planner. J14/J15 implementation remains blocked until the state/reducer boundary represents that grounded target.

## Focused pre-push verification

Strict TypeScript compile: PASS.

Planner tests: `27/27 PASS`, including:
- J01 missing dates / guests;
- deterministic availability proposal;
- matching pending invocation de-duplication;
- options + selection grounding boundary;
- explicit single/multi reserve proposal;
- multi-room capability absence fail-closed;
- room-count mismatch;
- approval/prepared execution waits;
- read quote while approval pending;
- grounded completion after confirmed execution;
- zero-result vs failure vs explicit retry;
- quote observation reuse;
- capability absence;
- cancel/modify booking-grounding fail-closed;
- no implicit RAG;
- no Planner-owned write retry;
- terminal task handling;
- explicit TaskDefinition dependency contracts;
- write fingerprint changes with commit semantics;
- complete synthetic J01 post-reducer traversal without LLM planning.

No provider inference, Worker deployment, HMS mutation or approval consumption occurred.

## Gate

`DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS` requires exact-head repository CI plus final contradiction review. This gate does not imply runtime wiring, Interpreter implementation or J01 real-model PASS.
