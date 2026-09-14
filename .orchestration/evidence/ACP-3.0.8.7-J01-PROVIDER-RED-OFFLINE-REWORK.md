# ACP-3.0.8.7 — J01 provider RED offline rework

Status: `J01_PROVIDER_RED_OFFLINE_REWORK_GREEN`

## Authority and no-retry boundary

The single provider-backed J01 preflight remains `RED / REWORK`.

Consumed execution:
- candidate application SHA: `038106db1f5e3dce140a35e05578f9a4151cb2e0`
- GitHub Actions run: `34788877608`
- prior Worker version: `93516779-815d-4995-a672-2321089610e0`
- candidate Worker version: `43da7cc6-4bd4-4e2d-b8ef-a84abb1fe608`
- temporary deployment split: prior `100%`, candidate `0%`
- exact candidate unauthenticated admission proof: HTTP `403`
- authenticated J01 preflight: HTTP `422`
- provider calls consumed: exactly `1`
- automatic retry: `0`
- HMS mutations: `0`
- approval consumption: `0`
- restore: exact prior Worker version restored as the only active version at `100%`

No second provider call is authorized by this rework.

## Historical Workers Observability recovery

A read-only Workers Observability query was executed in run `34795930043` for the exact consumed-call window. It did not invoke Workers AI, deploy a Worker, call HMS or consume an approval.

The historical telemetry correlates the authenticated `422` request to Worker version `43da7cc6-4bd4-4e2d-b8ef-a84abb1fe608` and experiment `acp3-j01-34788877608-1`.

Immediately before the provider call the durable budget snapshot showed:
- `inferenceCount = 0`
- `observedProviderNeurons = 0`
- `activeReservationCount = 1`
- `totalReservedAllowance = 180`
- status `ACTIVE`

After the provider result was settled it showed:
- `inferenceCount = 1`
- `observedProviderNeurons = 46.0898551940918`
- `activeReservationCount = 0`
- `totalReservedAllowance = 0`
- status `ACTIVE`

Therefore the single inference was durably reconciled. The original workflow failed to preserve token counts and its safe semantic failure receipt, so input/output token counts remain unknown.

## Failure localization

The provider call itself settled successfully. Provider transport failure would have produced HTTP `502`; the observed HTTP `422` proves the request reached one of the local fail-closed post-provider boundaries.

Possible boundaries at the exact consumed candidate were:
- provider identity missing;
- semantic output validation failed;
- interpreter boundary rejected;
- unexpected deterministic Planner step;
- write step blocked;
- operational state changed.

The exact `failureCode` is **not recoverable from the preserved run artifact** and must not be guessed.

Planner inspection rules out one tempting false diagnosis: an explicit reservation goal / active reserve intent does not itself cause a write before availability. With no availability observation, deterministic reservation planning first delegates to availability.

## Historical AI Gateway read attempt

A separate read-only diagnostic run `34795878064` attempted to read the already-existing AI Gateway log. The dedicated `CLOUDFLARE_OBSERVABILITY_API_TOKEN` was present but Cloudflare returned HTTP `403` for the AI Gateway logs endpoint.

This is consistent with the existing credential-separation contract: that token is intentionally scoped to Workers Observability, not AI Gateway Read. The deployment/control-plane token was not substituted or broadened. No inference or deployment occurred during this diagnostic.

## Offline rework implemented

### Safe RED diagnostics

Exact validated head: `174ae275a405eec6d8300182951dd94890057703`

core-ci: `#673 / 34795570778`

Result: `522/522 PASS`, typecheck PASS, staging syntax PASS, Wrangler dry-run PASS.

Changes:
- after a provider result has already been received, every semantic/planning RED path retains a sanitized provider receipt when available;
- the validation route may return bounded `failureCode`, bounded validation message and safe receipt fields on HTTP `422`;
- no raw model output is returned;
- no fallback parser was introduced;
- no validation rule was relaxed;
- no Planner/Core/Policy authority moved to the model.

### Semantic prompt / validator alignment

Exact validated head: `daa549c70c88798a0a26744af369e000b8f254e1`

core-ci: `#674 / 34795796009`

Result: `523/523 PASS`, typecheck PASS, staging syntax PASS, Wrangler dry-run PASS.

The semantic system prompt now explicitly states constraints already enforced by the validator:
- every `set` patch must carry a value;
- every `clear` patch must omit a value;
- empty semantic/directive containers must not be emitted;
- explicit absolute dates should be emitted directly without temporal provenance when trusted current time was not needed;
- temporal provenance is for relative/deictic resolution and must echo trusted temporal context and matching normalized dates exactly;
- the model still cannot select tools, reconstruct workflow control or author operational truth.

This is a conservative alignment change. It does **not** prove that one of these mismatches caused the consumed `422`.

## Current verdict

`J01_PROVIDER_RED_OFFLINE_REWORK_GREEN`

The offline implementation is improved and fully green, but the provider-backed J01 gate remains RED because the single authorized real inference returned HTTP `422`.

Before any future provider re-run is even considered, the execution workflow must preserve a sanitized RED response summary before asserting PASS so that another consumed call cannot lose its exact failure boundary.
