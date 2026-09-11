# R2.8.4 — Dedicated historical observability credential separation

Status: `OBSERVABILITY_READY_FOR_RUN_1`

## Scope and safety

Bounded technical REWORK only. The credential-separation changes were committed
and pushed as `bd74a29`, `9bc098a`, and `effcd8c`. The historical verification
ran at exact candidate `effcd8c887ca0115a62e03f5ab9c8f5f0c5cf68d`.

## Separation implemented

- `CLOUDFLARE_API_TOKEN` remains the deployment/Wrangler/control-plane token.
- `CLOUDFLARE_OBSERVABILITY_API_TOKEN` is now the only token accepted by
  `scripts/query-workers-observability.mjs`.
- The helper fails closed when the dedicated token is missing and preserves
  sanitized endpoint/status/primitive error metadata, including
  `documentation_url` when supplied.
- The full workflow injects the dedicated secret only into two
  historical-query-only steps: preflight query and broad reconciliation query.
- The same registered workflow has a manual `historical-observability-only`
  mode whose sole Cloudflare operation is the existing sanitized helper.
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
- Offline full QA: `320/320 PASS`.
- Focused credential/workflow tests: `5/5 PASS`.
- GitHub `core-ci` run `34255556038`: `success` at exact head.
- Node syntax and `git diff --check`: PASS.

## Remote verification

- External secret creation completed without exposing its value.
- GitHub workflow run `34255621797` used mode `historical-observability-only`.
- The first Cloudflare evidence operation was exactly
  `POST /accounts/{account_id}/workers/observability/telemetry/query` through
  `scripts/query-workers-observability.mjs`.
- Sanitized result: `OBSERVABILITY_HISTORICAL_QUERY_HTTP_2XX`, `success: true`,
  result object keys `events`, `run`, `statistics`.
- No deployment, Worker request, Workers AI inference, RUN 1, RUN 2, approval,
  or HMS mutation occurred.

`OBSERVABILITY_READY_FOR_RUN_1` is now reported. A new RUN 1 still requires a
new explicit Human Gate.
