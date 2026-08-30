# ACP 2.5 — Controlled Reservation Contract

Status: AUTHORIZED / IMPLEMENTED CANDIDATE / PRE-CRITIC
Scope: AI Commerce Platform + HMS staging only.

## Goal
Extend the accepted read-only E1 flow (availability → quote) with one governed reversible side effect: create a confirmed HMS staging reservation only after explicit human approval, with exact-operation authorization, deterministic downstream idempotency and controlled token-bound cleanup.

## Authorized surface
- `hms.createReservation` via HMS Service Binding.
- `hms.cancelReservation` only as controlled cleanup / explicitly approved cancellation of a reservation created through the governed ACP path.
- Trusted tenant → hotel route remains server-side.
- Fixed staging actor identity is server-side; request/model input cannot select it.
- Human approval challenge is server-issued, expiring and single-use.
- Approval is bound to session + tenant + actor + message + request idempotency key **and to the exact validated tool + arguments**.
- HMS remains authoritative for reservation semantics, inventory, persistence, mutation provenance and replay/conflict semantics.

## Required controls
1. `hms.createReservation` and `hms.cancelReservation` are tenant-enabled and policy=`approval`.
2. No mutation RPC is invoked before Human-in-the-Loop approval.
3. Tool input is validated before an approval challenge can be issued.
4. `/api/approve` requires an existing session, server-issued challenge and the same message/idempotency binding.
5. The server stores a SHA-256 fingerprint of the exact validated `toolId + input` being authorized; rerouting to another tool or different arguments after approval fails closed.
6. Approval metadata cannot be supplied through ordinary user headers/body/model output.
7. Challenge consumption is single-use and durable per session in Cloudflare Durable Object storage.
8. Every side effect requires a request idempotency key.
9. For create, the request idempotency key becomes the trusted HMS `operationToken`; it never comes from model/user tool arguments.
10. After a successful create, Agent Core stores a trusted server-side binding from `session + tenant + actor + bookingId` to the **original create operationToken**.
11. The production Worker implementation of that ownership mapping is durable in the same per-session Durable Object namespace.
12. A later cancellation has its own request idempotency key and Human Gate, but HMS receives the original create token recovered from the trusted ownership store. The cancellation request/model cannot choose or replace that token.
13. Cancellation fails closed if trusted ownership is absent or does not match session/tenant/actor/booking.
14. Service Binding route and HMS hotel grant are trusted configuration, not model/user input.
15. Downstream HMS idempotency remains authoritative; Core must not cache away a replay/conflict that HMS must observe.
16. A downstream response with `replayed: true` is recorded in Core audit as `replayed`, not `succeeded`.
17. Errors are normalized; no internal downstream details are exposed to the user.
18. No payment/financial mutation, production cutover, real customer data or paid-resource expansion is authorized.

## Acceptance evidence
- Exact-artifact CI must pass.
- Adversarial tests must cover forged approval, missing session/challenge/idempotency, exact-operation binding, rerouting after approval, invalid pre-approval input, single-use consumption, actor/tenant pinning, downstream replay visibility/audit, trusted create-token ownership and fail-closed cancellation without ownership.
- HMS exact artifact must independently pass its controlled reservation invariants and Critic before cross-repository E2E.
- Independent Critic PASS is required before promotion.

## Staging E2E after both repository gates PASS
1. Availability/quote in the same session.
2. Reservation request without approval → blocked and no HMS mutation.
3. Human approval → one confirmed staging reservation.
4. Same create operation replay → same HMS booking, replay semantics preserved and audited as replay.
5. Different payload with same create operation token → conflict.
6. Availability reflects occupied room-night.
7. New approved cancellation request → Core recovers original create token server-side and HMS cancels the owned booking.
8. Cleanup/cancellation replay is safe and availability is restored.

## Human Gate
This increment has explicit human authorization for staging-only supervised autonomy. Any expansion to production, payment mutation, real data, paid resources or broader autonomous write scope requires a new Human Gate.
