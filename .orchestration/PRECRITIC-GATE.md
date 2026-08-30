# Pre-Critic Gate — ACP 2.5 Controlled Reservation

Substantive artifact: `cec61660187969923da7ae34af524b094e9e762d`

- [x] Accepted E1 ancestry reconciled with `acceptance/staging` without product-tree change.
- [x] Human authorization bounded to HMS staging controlled reservation + cleanup.
- [x] Task Contract published.
- [x] `npm run qa` PASS on exact substantive artifact via GitHub Actions `33289958425`.
- [x] Wrangler dry-run PASS in the same exact-artifact CI job.
- [x] Tenant/hotel/actor routing remains trusted server configuration.
- [x] `createReservation` policy requires Human-in-the-Loop approval.
- [x] Approval challenge is server-issued, message/idempotency/session/tenant/actor bound, expiring and single-use.
- [x] Forged approval/request identity adversarial cases PASS.
- [x] Side effects require trusted idempotency key.
- [x] HMS `operationToken` cannot come from model/user tool input.
- [x] Downstream HMS idempotency remains authoritative; Core does not cache away replay.
- [x] Cancellation is separately approval-gated and forwards trusted operation token.
- [x] No payment/production/real-data/paid-resource scope added.
- [x] Full ACP 2.5 invariant classification published in `.orchestration/evidence/ACP-2.5-PRECRITIC.md`.
- [ ] Independent Critic PASS on the frozen substantive artifact and publication boundary.
- [ ] Merge/promotion.
- [ ] Cross-repository staging E2E after HMS 2.5 independently passes.

Pre-Critic verdict: `READY_FOR_INDEPENDENT_CRITIC`.
No technical PASS or staging deployment is claimed yet.
