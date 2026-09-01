# ACP 2.6.9 — R2.8.4 Workers AI 3036 Staging Blocker

Date: `2026-09-01`
Substage: `2.6.9-R2.8.4 — Real-Model Multi-Room Dialogue`
Verdict: `BLOCKED_EXTERNAL / NOT_TECHNICAL_PASS`
Product acceptance: `REWORK`
R2.9 authorization: `BLOCKED`
Alquileres authorization: `BLOCKED`

## Purpose

This artifact records the bounded diagnosis of the real-model failure observed while validating the natural HMS multi-room receptionist path. It distinguishes an external Workers AI account-limit condition from an Agent Core/HMS correctness defect.

No production cutover, paid-plan upgrade, model switch, retry expansion, second-vertical work, or relaxation of the real-model acceptance gate is authorized by this evidence.

## Frozen diagnostic artifact

- Branch: `feat/acp-2.6.9-r2.8.4-multi-room-dialogue`
- Head: `7085e8d221af08f10683f7dba915600414f6fa99`
- Workflow: `R2.8 multi-room dialogue`
- Run: `33541796425`
- Job: `99969600099`
- Exact deployed Worker Version ID: `bc8dd432-84b9-4a99-9115-5c382178b764`
- Evidence artifact ID: `9813920679`
- Evidence artifact SHA256: `13a6716167252ad6220656265749cb51a296117a417aafece4fac09c852039f5`

## Foundation gate

PASS.

- Tests: `226`
- Pass: `226`
- Fail: `0`
- Harness syntax: PASS
- Cloudflare credentials: PASS
- Exact-head deploy: PASS
- workers.dev health: PASS

The diagnostic hardening preserves only bounded provider categories. Arbitrary provider messages/descriptions are not surfaced in `ModelProviderError.message` or telemetry.

## Observability proof

PASS.

The workflow runs a foreground `wrangler tail` window before any model inference and sends a non-LLM POST probe to a nonexistent path. The probe returned `404` and was captured by the live tail, proving the telemetry transport before the corpus was allowed to run.

The captured probe reports the same exact deployed Version ID: `bc8dd432-84b9-4a99-9115-5c382178b764`.

## C06/C07 bounded dialogue result

The deterministic safety path remains technically coherent while the real provider is unavailable.

### C06

Natural request:

`Hola. Somos cuatro y queremos quedarnos del 1 al 3 de enero de 2030. ¿Qué tenés disponible?`

Observed:

- HTTP `200`
- four guests + dates persisted
- authoritative HMS availability returned
- rooms `101`, `102`, `103`, `203` visible
- `hms.checkAvailability`: `allowed` then `succeeded`
- no mutation

### C07

Natural request:

`Quiero reservar la 101 y la 102.`

Observed:

- HTTP `409`
- `APPROVAL_REQUIRED`
- `hms.createMultiReservation`: `approval_required`
- multi-room intent did not collapse into `hms.createReservation`
- approval challenge was not consumed
- no reservation/cancellation mutation executed

Dialogue harness summary:

- cases passed: `5/5`
- requests: `2`
- p95 latency: `1684 ms`
- reached approval challenge: `true`
- approval consumed: `false`
- HMS mutation requests: `0`

These functional passes do **not** satisfy R2.8.4 because the required model route did not execute successfully.

## Real-model telemetry

RED.

- successful model inferences: `0`
- model fallbacks: `3`
- fallback ratio: `1.0`
- input tokens: `0`
- output tokens: `0`
- route fallback category for both C06 and C07: `CloudflareError3036`

The provider failure is therefore classified as Workers AI internal code `3036`, not as a parser/prompt/HMS/multi-room defect.

## Provider interpretation

Cloudflare Workers AI documentation identifies internal code `3036` / HTTP `429` as `Account limited`: the account has exhausted its daily free allocation.

This diagnosis is materially different from:

- `3007` — request timeout
- `3040` — out of capacity
- malformed model output
- stale R2.4 multi-room prompt behavior
- single-room collapse
- HMS inventory or HITL failure

## Historical comparison

ACP 2.6.8 real-model staging on `2026-08-30` used the same baseline model, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, with the same Workers AI structured-call shape and recorded successful real-model inference with zero fallbacks.

That evidence prevents treating the present `3036` condition as proof that the adapter request shape or selected baseline model is intrinsically invalid.

## Verdict

`R2.8.4 = BLOCKED_EXTERNAL / NOT_TECHNICAL_PASS`

What is proven:

1. Foundation remains green (`226/226`).
2. Exact-head staging deployment is healthy.
3. Live observability is valid before inference.
4. Natural C06/C07 state, HMS grounding, multi-room routing and HITL boundary remain safe under deterministic fallback.
5. The current real-model failure is specifically Workers AI error `3036` (daily free allocation exhausted).

What is **not** proven:

1. natural real-model multi-room quality;
2. real-model route inference for C06/C07;
3. real-model response composition quality;
4. R2.8 technical closure;
5. R2.9 Product Acceptance eligibility.

## Next authorized action

Do not rework Agent Core to compensate for `3036` and do not silently upgrade infrastructure.

The next bounded action is to re-run the exact R2.8.4 real-model gate only when Workers AI free allocation is available again, unless a human explicitly authorizes a different provider/account-cost decision. A future PASS must contain successful inference telemetry from the frozen baseline model and must not depend on deterministic route fallback.
