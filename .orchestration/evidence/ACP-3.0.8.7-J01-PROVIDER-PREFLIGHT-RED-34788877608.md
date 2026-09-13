# ACP-3.0.8.7 J01 provider-backed preflight — REWORK

Date: 2026-09-13

## Immutable identities

- Candidate application SHA: `038106db1f5e3dce140a35e05578f9a4151cb2e0`
- Branch candidate was verified at: `feature/acp-3.0.8-implementation-foundation`
- Authorized GitHub Actions run: `34788877608`
- Diagnostic preflight-only run (no authenticated request): `34788784371`
- Temporary workflow was checked out from the candidate SHA and used the candidate SHA for tag and metadata.

## Deployment boundary

- Prior version: `93516779-815d-4995-a672-2321089610e0`
- Candidate version: `43da7cc6-4bd4-4e2d-b8ef-a84abb1fe608`
- Candidate tag: `038106db1f5e3dce140a35e05578f9a4151cb2e0`
- Temporary split verified: prior `100%`, candidate `0%`.
- Credential-free request reached the exact candidate and returned HTTP `403`.
- Restore ran under `if: always()` and Cloudflare API verification passed: exactly one version, prior at `100%`.

## Single provider execution

- Authenticated requests to `/__validation/acp3/j01-provider-preflight`: exactly `1`.
- Provider calls consumed: `1` (the first run stopped at the credential-free 404 boundary and made none).
- Model configured/expected: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- HTTP result: `422`.
- Semantic preflight verdict: `RED / REWORK`; no PASS receipt was produced.
- The workflow log records the RED at the response-validation boundary. The failing response body was not persisted by the workflow, so the internal route `failureCode`, token counts and provider neuron receipt are `NOT CAPTURED`; no inference retry is authorized.

## Safety boundary

- The candidate route uses `DurableExperimentBudgetProvider` and the fixed budget guard passed.
- The J01 route stops before Core/Policy tool admission; no HMS tool was executed.
- HMS mutations: `0`.
- Approval consumption: `0`.
- `PreparedOperation` creation: `0`.
- Normal candidate traffic: `0`; candidate was reached only through the exact version override request pair (403 admission proof plus one authenticated preflight).

## Verdict

`J01_PROVIDER_BACKED_PREFLIGHT_REWORK`

This evidence does not close ACP-3.0.8.7 and does not claim a provider-backed PASS.
