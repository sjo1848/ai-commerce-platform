# Pre-Critic Gate — ACP 2.5 Controlled Reservation

Substantive artifact: `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`

- [x] Accepted E1 ancestry reconciled with `acceptance/staging`.
- [x] Human authorization bounded to HMS staging controlled reservation + cleanup.
- [x] Updated Task Contract published.
- [x] Exact-artifact `core-ci` run `33290428385`, job `99200983748` PASS.
- [x] Worker config / Wrangler validation PASS in the same exact-artifact run.
- [x] Tenant/hotel/actor routing remains trusted server configuration.
- [x] `createReservation` and `cancelReservation` require Human-in-the-Loop approval.
- [x] Tool input is validated before approval can be issued.
- [x] Approval challenge is server-issued, request/session bound, expiring and single-use.
- [x] Approval is bound to the exact validated tool + arguments; rerouting after approval fails closed with zero HMS mutation.
- [x] Forged approval/request identity adversarial cases PASS.
- [x] Side effects require trusted idempotency key.
- [x] Create HMS `operationToken` cannot come from model/user tool input.
- [x] Successful create stores booking → original create-token ownership in trusted server-side storage.
- [x] Worker wires durable reservation ownership through the per-session Durable Object.
- [x] Cancellation uses a separately approved request but HMS receives only the stored original create token; missing ownership fails closed.
- [x] Downstream HMS idempotency remains authoritative; Core does not cache away replay.
- [x] Authoritative downstream replay is audited as `replayed`.
- [x] No payment/production/real-data/paid-resource scope added.
- [x] Full ACP 2.5 invariant classification/evidence refreshed to the final substantive artifact.
- [ ] Fresh Independent Critic PASS on `3d1a08376b9581dfc1fc159a6bf3b0733996fa61` and publication boundary.
- [ ] Merge/promotion.
- [ ] Cross-repository staging E2E after HMS 2.5 independently passes.

Pre-Critic verdict: `READY_FOR_INDEPENDENT_CRITIC`.
No technical promotion or staging deployment is claimed yet.
