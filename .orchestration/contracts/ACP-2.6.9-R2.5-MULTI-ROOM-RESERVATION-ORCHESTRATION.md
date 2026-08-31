# ACP 2.6.9-R2.5 — Multi-Room Reservation Orchestration

Status: `CONTRACT_FROZEN / IMPLEMENTATION_NOT_ACCEPTED`
Date: `2026-08-31`
Parent contract: `.orchestration/contracts/ACP-2.6.9-R2-NATURAL-RECEPTIONIST.md`
Previous gate: `2.6.9-R2.4 — TECHNICAL_PASS / CLOSED`

## Goal

Extend the grounded multi-room conversation model from R2.4 into controlled multi-room reservation and cancellation execution without weakening HMS authority, Policy, HITL, approval binding, idempotency, ownership, tenant isolation, auditability or single-room behavior.

R2.5 owns execution semantics only. R2.4 remains authoritative for multi-room selection, references, occupancy clarification and conversational grounding.

## Non-negotiable execution invariant

A multi-room request MUST NOT execute as a model-controlled loop of independent single-room reservations.

The server MUST construct an exact execution plan from authoritative HMS state, present one exact grounded confirmation summary, bind approval to that exact plan, revalidate immediately before mutation and orchestrate each side effect under server-owned identity, idempotency and audit controls.

The LLM MAY interpret intent and compose grounded prose. It MUST NOT choose trusted tenant/hotel/actor scope, approval metadata, `operationToken`, booking IDs, authoritative room IDs, compensation policy or HMS truth.

## Server-owned MultiRoomReservationPlan

The canonical plan MUST contain at least:

- trusted tenant / hotel scope;
- trusted actor / session scope;
- operation kind: create group, cancel one booking, or cancel complete group;
- check-in / check-out dates where applicable;
- total guest count where applicable;
- exact ordered authoritative room IDs;
- room numbers for human-readable confirmation;
- exact room-level occupancy when required;
- authoritative HMS availability / booking grounding revision;
- deterministic plan fingerprint;
- server-owned execution correlation / group identity.

No model-supplied trusted field may become canonical without server resolution and validation.

## Preflight gate

Before approval can be requested, the server MUST verify:

1. all selected rooms resolve to the current authoritative HMS candidate set;
2. dates remain valid;
3. guest totals and room-level occupancy are internally consistent;
4. all required rooms remain available for the requested stay;
5. no unresolved R2.4 room/occupancy clarification exists;
6. tenant, actor and session scope are valid;
7. Policy allows the planned mutation;
8. the plan contains no model-controlled trusted metadata.

A failed preflight MUST produce zero side effects.

## Human confirmation and exact-plan binding

Before any mutation, the user MUST receive one exact grounded summary of the complete plan.

Approval MUST bind to the exact deterministic plan fingerprint.

Any change to dates, guests, selected rooms, room occupancy, operation kind, booking set, trusted scope or authoritative grounding invalidates prior approval.

A stale approval MUST fail closed and require a new confirmation.

## Execution semantics

Multi-room execution is server orchestrated.

Each individual HMS mutation MUST have:

- server-generated operation identity / token;
- idempotency protection;
- tenant/actor ownership validation;
- trace/audit correlation;
- deterministic association with the approved group plan;
- authoritative post-condition recording.

The model MUST NOT choose execution order, operation tokens, approval metadata, booking IDs or compensation behavior.

## Lifecycle states

The orchestrator MUST explicitly represent at least:

- `PLANNED`
- `APPROVAL_REQUIRED`
- `APPROVED`
- `EXECUTING`
- `COMPLETED`
- `PARTIAL_FAILURE`
- `COMPENSATING`
- `COMPENSATED`
- `COMPENSATION_FAILED`

No partial outcome may be represented as full success.

## Partial failure and compensation

A multi-room create request is one logical group operation.

If one or more room reservations succeed and a later reservation fails, the orchestrator MUST:

1. stop further forward execution unless explicitly required for safe convergence;
2. persist the exact successful, failed and unattempted operations;
3. enter `PARTIAL_FAILURE`;
4. apply deterministic server-owned compensation to bookings created by the current execution attempt;
5. persist every compensation result;
6. report only authoritative final HMS state.

Default R2.5 policy: successful bookings created by the same failed group attempt are cancelled as compensation.

If all compensation succeeds, final state is `COMPENSATED` and the group reservation is not reported as created.

If any compensation fails, final state is `COMPENSATION_FAILED`; surviving authoritative booking IDs MUST be surfaced through grounded server facts and human intervention is required. The assistant MUST NOT claim atomic rollback.

## Timeout and uncertain-result invariant

A transport timeout is not proof that HMS did not mutate.

Before retrying a timed-out operation, the orchestrator MUST use idempotency / authoritative lookup to determine whether the mutation already committed.

Retries MUST NOT duplicate reservations or cancellations.

## Cancellation semantics

### Cancel one booking

The user may request cancellation of one authoritative booking belonging to a grounded multi-room group. Only that exact booking is included in the plan and approval fingerprint.

### Cancel complete group

The user may explicitly request cancellation of the complete grounded group. The server MUST enumerate the current authoritative bookings in the group before approval. The exact cancellation set is bound into the approval fingerprint.

### Ownership safety

A booking outside the current trusted tenant/actor scope or outside the grounded group MUST NOT be added to a cancellation plan by model output.

## Concurrency and stale grounding

Immediately before each mutation, authoritative HMS conditions required for that operation MUST be revalidated.

If availability, booking ownership or group membership changed after approval, execution MUST fail closed rather than substitute another room or booking automatically.

A newer authoritative plan/revision cannot be rolled back by stale conversation or execution state.

## Single-room compatibility

Existing single-room reservation and cancellation behavior MUST remain unchanged.

R2.5 MUST preserve:

- Tool Registry authority;
- server validation;
- Policy Engine;
- HITL;
- approval fingerprinting;
- idempotency;
- ownership;
- tenant isolation;
- audit / traceability;
- HMS as transactional source of truth.

## Required acceptance / adversarial regressions

At minimum freeze and prove:

1. create rooms 101 + 102;
2. create three rooms;
3. occupancy 101=2, 102=3;
4. inconsistent occupancy blocks execution;
5. change 102 → 103 before approval creates a new plan;
6. change selection after approval invalidates stale approval;
7. one room becomes unavailable after approval;
8. duplicate confirmation / duplicate retry is idempotent;
9. first create succeeds and second fails;
10. compensation succeeds;
11. compensation itself fails;
12. timeout after HMS mutation does not duplicate on retry;
13. cancel only one booking from a group;
14. cancel the complete group;
15. foreign / non-group booking injection is rejected;
16. stale cancellation approval is rejected;
17. model attempts to inject arbitrary room ID are rejected;
18. model attempts to inject `operationToken` / approval metadata are rejected;
19. unresolved room/occupancy clarification blocks all side effects;
20. multi-room intent never collapses into existing single-room `hms.createReservation`;
21. complete single-room regression suite remains green.

## Scope boundary

Explicitly out of scope:

- production cutover;
- payments;
- real customer data;
- WhatsApp;
- autonomous mutation without HITL;
- R2.6 model quality/latency/cost evaluation;
- second vertical / Alquileres.

## Exit gate

R2.5 can become `TECHNICAL_PASS / CLOSED` only after:

- implementation complete against this contract;
- exact-head core CI PASS;
- all tests green;
- TypeScript typecheck PASS;
- staging E2 syntax PASS;
- Wrangler dry-run PASS;
- dedicated QA PASS;
- Pre-Critic PASS;
- fresh Independent Critic PASS;
- open P0/P1/P2 = `0/0/0`;
- integration PR merged;
- post-merge `main` regression PASS;
- `.orchestration/STATE.md`, `.orchestration/STATUS.json`, closure evidence and Drive tracker converged.

R2.6 MUST NOT begin before this gate closes.
