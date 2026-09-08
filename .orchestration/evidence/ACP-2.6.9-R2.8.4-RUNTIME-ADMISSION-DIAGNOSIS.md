# R2.8.4 — Validation admission runtime discrepancy diagnosis

Status: `BLOCKED_FOR_HUMAN_GATE_ZERO_INFERENCE_REMOTE_PROOF`

## Authoritative failure

- Failed workflow: `34260151792`, attempt `1`
- Candidate SHA: `e7afc21fb82a8423ce3a3d638a6868a1111e796f`
- Exact deployed validation Worker Version: `fcb24c21-f818-402c-98ac-3af11252a33b`
- Experiment: `r28-34260151792-1`
- No contractual provider corpus started.

The deployed Worker reported the expected validation names in Wrangler output,
but unauthenticated runtime behavior was inconsistent:

- `GET /`: HTTP `200`
- `POST /__r28-tail-probe?run=34260151792-1`: HTTP `404`
- Body: `{"error":{"code":"NOT_FOUND"}}`

The run stopped before the historical query and before provider execution.

## Proven local facts

1. `src/validation-admission.ts` disables admission only when all three fields
   are `undefined`:

   - `ACP_VALIDATION_NEURON_BUDGET`
   - `ACP_VALIDATION_EXPERIMENT_ID`
   - `ACP_VALIDATION_RUN_TOKEN`

   Any partial, malformed, blank or wrong-token configuration remains active and
   returns HTTP `403` before application routing.

2. The 404 body is the downstream webchat not-found response. It is not proof
   of a missing probe route; it proves the request passed the outer admission
   boundary.

3. `wrangler.jsonc` declares no validation `vars` or `secrets`; deploy-time
   injection is required.

4. Installed Wrangler is `4.127.1`. Its local source shows:

   - `--var "NAME:VALUE"` becomes a `plain_text` upload binding.
   - `--secrets-file` JSON entries become `secret_text` upload bindings.
   - Both are included in the upload form metadata.

5. The failed run's Wrangler output reported the names for model, affinity,
   budget, experiment and token bindings, and exact active-version checks passed.
   That proves CLI assembly/display, not immutable-version metadata or runtime
   availability.

## Root-cause classification

Strongest current inference: the serving runtime had all three admission
bindings absent, or the request reached a different/unconverged version despite
control-plane selection. This is classified as:

`EXECUTION_OR_EVIDENCE_DEFECT_RUNTIME_BINDING_OR_VERSION_DISCREPANCY`

Competing causes not yet distinguishable without remote metadata:

- uploaded binding manifest differs from Wrangler display;
- deployment/version propagation or edge-version mismatch;
- Cloudflare accepted metadata but did not expose it to the serving runtime;
- less likely, a Worker implementation/runtime defect.

No provider, quota, HMS, approval, NLU-boundary or probe-route defect is
established.

## Harness correction

The validation deployment readiness gate now accepts **only HTTP 403**. A 2xx,
404, curl error or any other status fails the gate before tail/probe/provider
steps. Regression coverage asserts that 2xx and 404 cannot be accepted.

Offline verification:

- `npm run qa`: `321/321 PASS`
- Focused validation/admission tests: `23/23 PASS`
- Node syntax checks: PASS
- `git diff --check`: PASS
- No remote activity was performed for this correction.

## Required bounded remote plan after Human Gate

1. Metadata-only control-plane inspection of immutable Version
   `fcb24c21-f818-402c-98ac-3af11252a33b`:
   deployment identity, tag/SHA, active percentage, binding names/types,
   plain-text validation values only where safe, and secret binding presence
   without retrieving or printing its value.
2. If correction is required, deploy one fresh exact candidate only for
   zero-inference validation.
3. Require exact candidate/version correlation.
4. Require unauthenticated `GET /` = exactly `403`.
5. Require unauthenticated unique probe = exactly `403`.
6. Run the dedicated historical observability query and require sanitized 2xx.
7. Reconcile zero model/provider/reserve/HMS/approval evidence and clean up.

Only after all checks pass may the system report
`VALIDATION_ADMISSION_READY_FOR_RUN_1`. No provider inference, corpus, HMS
call, approval, RUN 1, RUN 2, merge or closure is authorized by this evidence.
