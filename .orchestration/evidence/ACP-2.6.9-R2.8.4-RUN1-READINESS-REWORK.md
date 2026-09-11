# R2.8.4 — Pre-RUN-1 technical readiness REWORK

Status: IN_PROGRESS — no provider run authorized or executed.
Baseline reviewed Git/PR artifact: `856ab7637901b628680ba6fbf4104ce1b4147585`. Final pushed substantive candidate: `e31d8c857154bba6ecd44e5501e85cedfe3d3072`.
Scope: the Product Owner authorized bounded implementation, offline tests, independent QA/verification, durable convergence and safe commit/push. RUN 1, deployment, inference, approval, mutation, merge, closure and R2.8.5 remain gated.

## Recovered discrepancies

- Baseline Git and PR #63 matched. Local STATE/STATUS still called `6d5a70a…` current; their core/dialogue CI entries were historical.
- Exact baseline core CI runs `34181523976` and `34181521694` passed. Dialogue `34181521681` failed admission preparation before deployment/inference; its post-corpus version step also failed because no version existed.
- GitHub variable `ACP_VALIDATION_NEURON_BUDGET` and secret `ACP_VALIDATION_RUN_TOKEN` were present by name. No secret value was read, printed or copied. Presence alone does not validate JSON or prove account quota.
- PR review recovery found 20 unresolved threads, 16 not outdated. Thread status alone is not a defect verdict; dispositions follow current code and contract.
- Baseline local changes were three orchestration files plus 18 untracked historical evidence files. They were preserved; no reset, discard or destructive checkout occurred.
- The handoff's exact-artifact Critic PASS was not located in durable evidence. Fresh independent review is required for this candidate.

## Consumption safety correction

Two regressions were frozen RED before budget implementation: a timeout freed its reservation, and zero allowance was accepted. The bounded fix retains every reservation after a provider rejection because the provider interface supplies no proof of pre-dispatch non-consumption. Positive allowance is enforced by admission, provider, DO reserve and stored-state parsing. Worker admission uses the lesser of the run cap and configured daily remainder. The unused in-memory wrapper is not the deployed validation guard.

Historical CH2B1-R3 PASS remains historical proof, not current exact-SHA staging acceptance. No CH-1.4 or cache/prompt/model/affinity optimization was opened. No provider quota was consumed by this REWORK.

## Exact-head convergence

The substantive candidate was pushed once after the workflow was proven manual-only. GitHub runs `34241858978` and `34241864626` completed SUCCESS for exact head `e31d8c8`. No R2.8 dialogue workflow run was created by the push. Local `npm test` and `npm run qa` completed `315/315 PASS`; targeted harness, preflight, budget and core regression tests passed. This is technical readiness evidence only; it does not assert staging GREEN or product acceptance.
