# ACP 2.5 — Controlled Reservation Contract

Status: AUTHORIZED / IMPLEMENTED CANDIDATE / PRE-CRITIC PENDING
Scope: AI Commerce Platform + HMS staging only.

## Goal
Extend the accepted read-only E1 flow (availability → quote) with one governed reversible side effect: create a confirmed HMS staging reservation only after explicit human approval, with deterministic downstream idempotency and controlled token-bound cleanup.

## Authorized surface
- `hms.createReservation` via HMS Service Binding.
- `hms.cancelReservation` only as controlled cleanup / explicitly approved cancellation bound to the same operation token.
- Trusted tenant → hotel route remains server-side.
- Fixed staging actor identity is server-side; request/model input cannot select it.
- Human approval challenge is server-issued, bound to session + tenant + actor + message + idempotency key, expiring and single-use.
- HMS remains authoritative for reservation semantics, inventory, persistence and mutation provenance.

## Required controls
1. `hms.createReservation` is tenant-enabled and policy=`approval`.
2. No mutation RPC is invoked before approval.
3. `/api/approve` requires an existing session, server-issued challenge and the same idempotency key/message fingerprint.
4. Approval metadata cannot be supplied through ordinary user headers/body/model output.
5. Challenge consumption is single-use and durable per session in Cloudflare Durable Object storage.
6. Side effects require an idempotency key.
7. `operationToken` sent to HMS comes only from trusted execution metadata, never model/user arguments.
8. Service Binding route and HMS hotel grant are trusted configuration, not model/user input.
9. Downstream HMS idempotency remains authoritative; Core must not hide replays from HMS.
10. Errors are normalized; no internal downstream details are exposed to the user.
11. No payment/financial mutation, production cutover, real customer data or paid-resource expansion is authorized.

## Acceptance evidence
- Exact-artifact CI must pass.
- Adversarial tests must cover forged approval, missing session/challenge/idempotency, challenge binding, single-use consumption, actor/tenant pinning and downstream replay.
- HMS exact artifact must independently pass its controlled reservation invariants and Critic before cross-repository E2E.
- Independent Critic PASS is required before promotion.

## Staging E2E after both repository gates PASS
1. Availability/quote in the same session.
2. Reservation request without approval → blocked and no HMS mutation.
3. Human approval → one confirmed staging reservation.
4. Same operation replay → same HMS booking, replay semantics preserved.
5. Different payload with same operation token → conflict.
6. Availability reflects occupied room-night.
7. Token-bound approved cleanup/cancellation.
8. Cleanup replay is safe and availability is restored.

## Human Gate
This increment has explicit human authorization for staging-only supervised autonomy. Any expansion to production, payment mutation, real data, paid resources or broader autonomous write scope requires a new Human Gate.
