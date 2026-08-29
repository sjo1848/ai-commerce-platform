# ACP-I01 Pre-Critic Evidence

Date: 2026-08-29

## Automated validation

- TypeScript strict typecheck: PASS.
- Build: PASS.
- Test suite: PASS — 21/21, 0 failures.
- Coverage: 99.40% lines / 84.68% branches / 96.03% functions.
- E2E webchat vertical slice: PASS; see `ACP-I01-E2E.json`.

## Adversarial QA findings repaired

### REWORK-1 — idempotency scope
Finding: raw idempotency keys were global in the in-memory store, causing cross-tenant collisions.
Repair: storage keys are scoped by tenant while actor/tool/payload conflict checks remain binding.
Regression: `same client idempotency key is isolated between tenants` PASS.

### REWORK-2 — impossible calendar dates
Finding: `Date.parse` normalizes dates such as `2026-02-31` instead of rejecting them.
Repair: strict ISO calendar parser compares parsed UTC components to the source date.
Regression: `fake HMS rejects impossible calendar dates instead of Date normalization` PASS.

## Invariant evaluation

- I-01 PASS — body tenant override ignored; trusted adapter context is authoritative.
- I-02 PASS — session replay across tenant/actor fails closed.
- I-03 PASS — malicious model cannot invoke non-visible tool.
- I-04 PASS — permission deny and risk approval tests.
- I-05 PASS — required/replay/conflict + cross-tenant idempotency tests.
- I-06 PASS — allowed/succeeded/denied/failed/replayed events covered.
- I-07 PASS — boundary scan found no HMS/Alquileres persistence imports.
- I-08 PASS — adapter errors normalized to `TOOL_EXECUTION_FAILED`.
- I-09 PASS — quote total remains integer cents.
- I-10 PASS — no deploy or paid Cloudflare resource action occurred.

## Boundary scan

No references to HMS/Alquileres repositories, Prisma, PostgreSQL, D1 database bindings, or SQLite persistence exist under `src/`. The only `fetch` use is the browser webchat calling its own `/api/chat` endpoint and the Worker `fetch` entrypoint.

## Decision

PRE-CRITIC PASS. Eligible for immutable artifact publication and artifact-based critic review.
