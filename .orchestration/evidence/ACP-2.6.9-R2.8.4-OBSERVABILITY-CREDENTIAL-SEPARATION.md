# R2.8.4 — Dedicated historical observability credential separation

Status: `READY_FOR_EXTERNAL_SECRET_CREATION`

## Scope and safety

Bounded technical REWORK only. Exact authoritative HEAD remains
`0ee9324cdcf26094413c9e9059b934cc390e0d2d`; the working tree is intentionally
dirty and no commit, push, deployment, Worker request, provider inference,
HMS call, approval call, or workflow dispatch was performed.

## Separation implemented

- `CLOUDFLARE_API_TOKEN` remains the deployment/Wrangler/control-plane token.
- `CLOUDFLARE_OBSERVABILITY_API_TOKEN` is now the only token accepted by
  `scripts/query-workers-observability.mjs`.
- The helper fails closed when the dedicated token is missing and preserves
  sanitized endpoint/status/primitive error metadata, including
  `documentation_url` when supplied.
- The workflow injects the dedicated secret only into two historical-query-only
  steps: preflight query and broad reconciliation query.
- The tail/probe step has no dedicated observability secret.
- Dialogue, corpus, validation-header, application, and provider inputs do not
  receive the dedicated token.
- Both deployment token and dedicated token are never printed.

## Minimum external permission

Create GitHub secret `CLOUDFLARE_OBSERVABILITY_API_TOKEN` from a Cloudflare API
token with only:

- Account permission: `Workers Observability Write`
- Resource scope: the target `CLOUDFLARE_ACCOUNT_ID` only

Do not replace or broaden `CLOUDFLARE_API_TOKEN`.

## Local proof

- Dedicated credential tests: `5/5 PASS`
- R2.8.4 boundary regression selection: `31/31 PASS`
- Node syntax checks: PASS
- `git diff --check`: PASS
- Engineering QA: `QA_PASS`
- No CI was dispatched because the authoritative candidate was not changed or
  pushed.

## Required Human Action / next verification

The Human/credential owner must create the dedicated GitHub secret without
revealing its value. After that external change, the first remote operation
must be only the historical observability query. It must verify a sanitized
successful JSON response (including an empty result set) or retain sanitized
403 metadata. No deployment, Worker call, provider inference, RUN 1, RUN 2,
approval, or HMS mutation is authorized by this change.

Only after that query succeeds may the system report
`OBSERVABILITY_READY_FOR_RUN_1`; a new RUN 1 still requires a new explicit
Human Gate.
