# ACP-2.6.9-R2.8.4 — CH-1.3 Validation Traffic Isolation

## Scope and exact artifact

- Sub-stage: `R2.8.4 ACTIVE / ARCHITECTURAL_REWORK`.
- Exact baseline HEAD: `db1ede91e0cb846b667d9f5f9683a34852950b2f`.
- The CH-1.3 implementation remains uncommitted in the working tree; no prior commits or local changes were reset, rebased, checked out destructively, restored or discarded.
- Intended implementation files: `src/worker.ts`, `src/validation-admission.ts`, `test/validation-traffic-isolation.test.mjs`.
- Working-tree content hashes: `src/worker.ts` `3ceb290041795f6b9b70f4b5387533677da9f0b3`; `src/validation-admission.ts` `1eb3a829348293bc27635ab2debf1f7d59f1c7e1`; `test/validation-traffic-isolation.test.mjs` `6804ae46af48686c8be5bf2d02f913df969fb25d`.
- `WORKERS_AI_CALLS_THIS_BLOCK=0`.

## Root cause

`ACP_VALIDATION_EXPERIMENT_ID` is server/deployment configuration. `src/worker.ts` constructs `DurableExperimentBudgetProvider` with a `DurableObjectExperimentNeuronBudgetStore` keyed by `experiment-budget:<experimentId>`. Consequently, every request reaching that validation deployment can consume the same experiment ledger. A unique experiment ID is a ledger identity, not an admission boundary; the stored-log recovery observed another session consuming the exact experiment before the target.

Positive incidental CH-1.2 evidence is preserved but not attributed to the target smoke: on the other trace, `114.66338348388672 + 19.711647033691406 = 134.37503051757812` provider neurons, exactly equal to durable `observedProviderNeurons`, with `inferenceCount=2` equal to the two inferences.

## Isolation design

The smallest existing-boundary change is an outer Worker admission guard:

- Validation mode activates when any of `ACP_VALIDATION_NEURON_BUDGET`, `ACP_VALIDATION_EXPERIMENT_ID` or `ACP_VALIDATION_RUN_TOKEN` is configured.
- The server-only secret is `ACP_VALIDATION_RUN_TOKEN`.
- The inbound validation header is `x-acp-validation-run-token`.
- Missing, empty, partial/malformed or incorrect validation configuration/credential returns generic HTTP `403 Forbidden`.
- The guard runs in `fetch` before `handler(env)`, so rejected requests cannot construct Agent Core, the provider, budget store, session store, HMS adapter path or approval path.
- A correct credential follows the existing handler path. The header is removed before the request is forwarded to Core, so it is not application input.
- `ACP_VALIDATION_EXPERIMENT_ID` remains server-owned and independent from `sessionId`.
- With all validation configuration absent, the original request object and normal behavior are preserved.

The credential is never inserted into prompts, messages or schemas, never serialized by the admission module, never logged or emitted as telemetry, and is not committed to Git.

## Zero-inference tests and QA

- Isolation tests A–L: PASS; targeted build plus isolation, budget and prompt-golden tests: `24/24 PASS`.
- Existing R2.8.4 NLU/grounding, fail-closed, HITL and idempotency regression selection: `29/29 PASS`.
- `npm run qa`: `280/280 PASS`; typecheck PASS.
- Prompt golden byte-equivalence: PASS; authorized and normal no-config prompt hash remains `4989b5d3a4aff1992bdd1f43f4ca699c9df3f33da973afed2ae24147aa41961c`.
- Rejected-request counters for construction, provider, reserve, HMS and approval remain zero in the isolation tests.
- Correct-credential forwarding removes the credential header; fake downstream prompt/log/telemetry observations contain no credential.
- Wrangler dry-run: PASS (`253.57 KiB`, `54.80 KiB` gzip).
- Engineering QA on the exact working-tree artifact anchored at HEAD `db1ede91e0cb846b667d9f5f9683a34852950b2f`: `QA_PASS`.
- No Worker request, deployed `/api/chat`, provider call, HMS call, approval consumption, corpus, affinity experiment or deployment was executed.

## Rollback and remaining risks

- Operational rollback: omit all validation configuration, which preserves the normal path; the credential is not required in ordinary deployments.
- Source rollback reference: exact pre-CH1.3 local baseline HEAD `db1ede91e0cb846b667d9f5f9683a34852950b2f`; no rollback was performed.
- Remaining risk: the admission boundary is verified offline only; deployment/runtime secret provisioning and a future isolated real-model smoke still require their own authorized gate and Workers Logs evidence.
- Live-tail remains an optional operational view; future evidence must use stored Workers Logs/Workers Observability, with a fresh experiment ID, isolated validation credential and unique request ID.
- R2.8.4 is not technically closed, R2.8.5 remains blocked, and no smoke is authorized in this block.

## Recommendation

`READY_TO_REPEAT_CH2B1_ISOLATED` — recommendation only after this zero-inference implementation and Engineering QA. Do not execute the smoke, merge, close R2.8.4 or advance R2.8.5 in this block.
