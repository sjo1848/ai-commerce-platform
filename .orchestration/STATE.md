# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.5`
Task: `ACP-2.5-CONTROLLED-RESERVATION`
Status: `EXTERNAL_REVIEW`
Current sub-stage: `2.5 — CONTROLLED SIDE EFFECT / STAGING ONLY`
Substantive artifact: `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`
Work branch: `feature/acp-2-5-controlled-reservation`
Accepted E1 ancestry reconciled through `acceptance/staging` head `43b9d75371ed29604509537dac898e059534fbcb`.

## Authoritative scope
Human authorization exists for a staging-only supervised reservation side effect. The accepted read-only availability → quote flow remains the prerequisite path.

Authorized:
- `hms.createReservation` through trusted HMS Service Binding.
- explicit Human-in-the-Loop approval bound to the exact validated operation;
- durable, expiring, single-use approval challenge;
- downstream-persistent create idempotency using the trusted request key as HMS `operationToken`;
- trusted durable ownership mapping from booking to the original create token;
- separately approved `hms.cancelReservation`, with HMS receiving the stored original create token;
- synthetic Hotel Norte staging data only.

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
- Approval is bound to session + tenant + actor + normalized message + request idempotency key + exact validated tool/input fingerprint.
- Successful create binds booking ownership to its original operation token in server-side storage; production Worker wiring uses the session Durable Object.
- Cancellation has its own approval/request key but fails closed unless the original create token can be recovered from the trusted ownership binding.
- HMS remains authoritative for booking rules, inventory, mutation provenance and replay/conflict semantics.
- Authoritative downstream replays are audited as `replayed` in Core.

## Exact executable evidence
`core-ci` run `33290428385`, job `foundation` `99200983748` — SUCCESS on substantive artifact `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`.

## Contract / evidence
- `.orchestration/contracts/ACP-2.5-CONTROLLED-RESERVATION.md`
- `.orchestration/INVARIANTS.md`
- `.orchestration/evidence/ACP-2.5-PRECRITIC.md`

## Current gate
The candidate cannot be promoted yet. Required sequence:
1. fresh Independent Critic on artifact `3d1a08376b9581dfc1fc159a6bf3b0733996fa61` plus publication evidence;
2. only after PASS, reconcile/promote for staging deployment;
3. HMS 2.5 must independently reach Critic PASS;
4. execute the synthetic cross-repository staging E2E;
5. return to Human Product Acceptance for the real supervised flow.

No production or market-validation claim is made by this technical increment.
