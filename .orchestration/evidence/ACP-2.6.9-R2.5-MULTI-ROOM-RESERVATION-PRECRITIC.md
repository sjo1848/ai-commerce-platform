# ACP 2.6.9-R2.5 — Multi-Room Reservation Orchestration — Pre-Critic Gate

Status: `PASS`
Date: `2026-09-01`
PR: `#48`
Substantive Artifact A: `f5b2c3313e2ac5e97d820ea67fa4dcd74e184b0b`
QA revalidation evidence: `.orchestration/reviews/ACP-2.6.9-R2.5-QA.md`
Contract: `.orchestration/contracts/ACP-2.6.9-R2.5-MULTI-ROOM-RESERVATION.md`
Converged pre-gate head: `4c0716189ffcbfce30ba85968f58e7fc22756a68`
Exact-head CI: `33460256267` / run #427 — PASS (`198/198` tests)

## Pre-Critic scope

This gate reviewed R2.5 as an execution boundary rather than repeating feature QA. The review focused on whether the implementation preserves the authority model already established by ACP 2.5 / R2.1–R2.4 while adding multi-room mutations.

## Gate checks

- R2.5 contract exists and remains limited to HMS multi-room reservation/cancellation execution: PASS
- production cutover, payments, WhatsApp requirements, paid expansion and second vertical remain unauthorized: PASS
- `hms.createMultiReservation` is an HMS adapter capability while Core retains generic governance: PASS
- model-visible multi-room create schema cannot author canonical room IDs, dates or guest identity: PASS
- model-visible group cancellation schema cannot author booking IDs: PASS
- canonical room set comes from durable R2.4 server-owned selection: PASS
- canonical stay dates come from durable semantic state: PASS
- trusted guest identity is injected from tenant+actor mapping before fingerprinting: PASS
- exact human approval is required before composite create and group/single cancellation mutations: PASS
- approval challenge is bound to trusted tenant/actor/session, original message, root idempotency key, exact operation fingerprint and exact stored ToolPlan: PASS
- approval consumption executes the stored canonical plan without a second model routing pass: PASS
- approved create plan is re-grounded against current selected rooms and stay dates before execution: PASS
- approved group cancellation is re-grounded against current active booking IDs before execution: PASS
- specific cancellation references resolve from server-owned booking↔room evidence before model-proposed booking IDs: PASS
- stale/unknown/ambiguous explicit room references fail closed and cannot retarget the only remaining booking: PASS
- hidden reservation-group snapshots are excluded from model-visible conversation history: PASS
- `activeBookingIds[]` and `activeBookings[]` remain server-owned and are updated from execution evidence, not model prose: PASS
- child create operation tokens are deterministic, server-derived and unavailable to model/request authority: PASS
- initial multi-room execution performs aggregate availability preflight plus fresh per-child availability revalidation: PASS
- a definitive failure stops later creates and compensates prior successful children deterministically: PASS
- compensation success/failure is represented explicitly; atomicity is never fabricated: PASS
- group cancellation pre-verifies ownership for all children before first irreversible mutation: PASS
- ownership/token binding is re-read before every irreversible child cancellation: PASS
- partial group cancellation retains only failed/active booking IDs for follow-up: PASS
- thrown mutating RPC uncertainty is reconciled exactly once with the same downstream token: PASS
- repeated uncertainty becomes `OUTCOME_UNKNOWN` and does not start later mutations or speculative compensation: PASS
- trusted recovery replays the exact stored ToolPlan, fingerprint, message and root idempotency key without model reroute: PASS
- recovery depth is persisted server-side, cannot be reset by request/model input and exhausts after three recovery challenges: PASS
- recovery deliberately does not use availability as authority for already-committed children; exact-token HMS replay is authoritative: PASS
- Core-level completed side-effect idempotency is now bound to exact tenant + actor + session + tool + canonical fingerprint: PASS
- same actor cannot replay a cached Core-idempotent result into another session: PASS
- cross-session reuse conflicts without executing a duplicate side effect or migrating booking/group state: PASS
- tenant/actor/session isolation, Policy/HITL, ownership and prior single-room semantics remain green: PASS
- QA was rerun/revalidated after the Pre-Critic-triggered Core idempotency change: PASS
- exact-head regression suite after contract + QA convergence: `198/198 PASS`: PASS
- TypeScript/typecheck: PASS
- staging E2 runner syntax: PASS
- Wrangler dry-run: PASS

## Pre-Critic finding and rework

The first Pre-Critic pass found one real P2 coherence gap: Core idempotency cached tenant+actor+tool+fingerprint but not session. Because approvals and reservation ownership are session-bound, a same-actor cross-session replay could migrate a cached composite result into a session that did not own the bookings.

Frozen red evidence:
- commit `94db6bab47a7fc2d193ab50ba588012c6816e30d`;
- core-ci `33460043489` / run #423;
- `197/198 PASS`; only the new cross-session isolation regression failed.

Rework:
- `2a3fca98cb07d57682da47e546ddb504b5efdd94` adds trusted `sessionId` to Core idempotency records;
- `f5b2c3313e2ac5e97d820ea67fa4dcd74e184b0b` rejects cross-session replay and persists session scope on completed results.

Revalidation:
- core-ci `33460108417` / run #425: `198/198 PASS`;
- contract and QA reclosure converged on `4c0716189ffcbfce30ba85968f58e7fc22756a68`;
- core-ci `33460256267` / run #427: `198/198 PASS`.

Finding status: `CLOSED`.

## Severity gate

Open P0: `0`
Open P1: `0`
Open P2: `0`

No substantive code changes are authorized after Artifact A without invalidating this gate and requiring QA revalidation + a fresh Pre-Critic pass.

Verdict: `PRE_CRITIC_PASS`

Next authorized gate: fresh Independent Critic. Staging conversational validation, merge, post-merge closure and R2.6 remain blocked until their respective gates pass.
