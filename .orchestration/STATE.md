# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.5`
Task: `ACP-2.5-CONTROLLED-RESERVATION`
Status: `PRECRITIC_REVALIDATION`
Current sub-stage: `2.5 — CONTROLLED SIDE EFFECT / STAGING ONLY`
Substantive artifact: `cec61660187969923da7ae34af524b094e9e762d`
Work branch: `feature/acp-2-5-controlled-reservation`
Accepted E1 ancestry reconciled through `acceptance/staging` head `43b9d75371ed29604509537dac898e059534fbcb` without changing the substantive tree.

## Authoritative scope
Human authorization exists for a staging-only supervised reservation side effect. The accepted read-only availability → quote flow remains the prerequisite path.

Authorized:
- `hms.createReservation` through the trusted HMS Service Binding.
- Explicit Human-in-the-Loop approval before reservation mutation.
- Durable, bound, expiring, single-use approval challenge.
- Downstream-persistent idempotency using the trusted request idempotency key as HMS `operationToken`.
- `hms.cancelReservation` only as approved/token-bound controlled cleanup or cancellation.
- Synthetic Hotel Norte staging data only.

Forbidden without a new Human Gate:
- production cutover;
- real customer data;
- payment/financial mutation;
- paid resource expansion;
- autonomous writes without the configured approval boundary;
- broader mutation tools beyond this contract.

## Control boundary
- Tenant and hotel routing are server-side trusted configuration.
- Staging actor identity is pinned server-side.
- User/model input cannot set `operationToken`, approval metadata, tenant route or hotel binding.
- Mutation tools remain policy=`approval`.
- Approval is bound to session + tenant + actor + normalized message + idempotency key and is single-use.
- HMS is authoritative for booking rules, inventory, persistence, mutation provenance and replay/conflict semantics.

## Contract
`.orchestration/contracts/ACP-2.5-CONTROLLED-RESERVATION.md`

## Current gate
The substantive candidate exists but cannot be promoted yet. Required sequence:
1. exact-artifact CI on `cec61660187969923da7ae34af524b094e9e762d`;
2. publish complete 2.5 invariant classification and Pre-Critic evidence anchored to the exact artifact;
3. Independent Critic PASS;
4. only then promote/reconcile for staging deployment;
5. after HMS 2.5 independently passes its Critic, execute the synthetic cross-repository staging E2E;
6. return to Human Product Acceptance for the real supervised flow.

No production or market-validation claim is made by this technical increment.
