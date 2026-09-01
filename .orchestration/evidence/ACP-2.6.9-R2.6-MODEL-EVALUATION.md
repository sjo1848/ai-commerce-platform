# ACP 2.6.9-R2.6 — Model Quality / Latency / Cost Evaluation

Status: `TECHNICAL_PASS / CLOSED`

## Frozen contract

Contract: `.orchestration/contracts/ACP-2.6.9-R2.6-MODEL-EVALUATION.md`

R2.6 evaluates the HMS receptionist model path without changing the deterministic authority boundary. Model selection is deployment-controlled; trusted tenant/hotel/actor context, policy/HITL, approval fingerprints, idempotency, operation tokens, ownership and HMS transactional truth remain server-owned.

## Final substantive head

`4fd636b599cd2a3389ca94e289146cdcc74485ab`

Integration PR: #50 — `feat(2.6.9-R2.6): evaluate model quality, latency and cost`.

Legacy draft PR #49 contains the completed review submissions and was superseded only because the connector could not transition the draft flag through its GraphQL wrapper; no scope/code divergence was introduced.

Exact substantive core CI: `33464908885` — PASS.

Final suite: `211/211 PASS`, including typecheck, unit/regression tests, staging E2E syntax and Wrangler dry-run.

## Real-model staging comparison

Workflow: `R2.6 model evaluation` run `33464946093` — PASS.

Artifact: `r2.6-model-evaluation`, artifact id `9784554147`, SHA256 `9e203e1d1038802a456b7d665e07c27a28ee7840f9177ab5ca526a5c9d5f814a`.

### Authorized baseline

Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

- evaluation corpus: `13/13 PASS`;
- operational: `6/6`;
- grounding: `2/2`;
- safety: `3/3`;
- quality: `2/2`;
- receptionist quality proxy: `1.0`;
- model inferences: `23`;
- model fallbacks: `1`;
- fallback ratio: `4.1667%`;
- input tokens: `38,410`;
- output tokens: `1,109`;
- estimated evaluation cost: `$0.013752707`;
- end-to-end median: `3.636 s`;
- end-to-end p95: `6.589 s`;
- provider median: `1.735 s`;
- provider p95: `4.123 s`.

The baseline satisfies the frozen R2.6 hard gates and is `eligible=true`.

### Candidate

Model: `@cf/openai/gpt-oss-20b`

- evaluation: `10/13`;
- valid model inferences: `0`;
- model fallbacks: `23`;
- fallback ratio: `100%`;
- observed model telemetry: none;
- fallback reason: `provider_failure` for all model calls.

The candidate is `eligible=false` on the current structured Workers AI path.

### Decision

`RETAIN_BASELINE`

The hardened comparison requires exact observed-model identity. Because the candidate produced no valid candidate-model telemetry and failed its hard gates, no model switch is authorized.

After comparison the authorized baseline was restored. Restored Worker version id: `ca1cb430-aa17-4c4a-b25c-f11b2058b032`.

## QA / rework record

QA found and closed three R2.6 P1 defects:

1. comparison could accept telemetry from a model other than the explicitly deployed candidate/baseline;
2. an acknowledgement could invent a payment/card/cash next step outside the safe meaning;
3. the missing-date evaluator could false-pass because `día` matched inside `estadía`.

All three were corrected and covered by regression tests before the final real-model run.

QA verdict: `PASS / RECLOSED`.

## Pre-Critic

Legacy PR #49 review `5073654629`: `PASS`.

Verified frozen contract, exact-head CI, strengthened real-model evidence, baseline restoration and the resolved QA findings.

## Independent Critic

Legacy PR #49 review `5073655778`: `PASS`.

Independent falsification focused on model identity, safety/grounding, quality-gate integrity and restoration after candidate evaluation.

Open R2.6 findings: `P0/P1/P2 = 0/0/0`.

## Integration and post-merge regression

- Integration PR: #50.
- Merge commit: `4f7741ac01505c77b73460f91737c209166ffcd0`.
- Final PR-head core CI: `33465429869` / #453 — PASS.
- Post-merge `main` core CI: `33465499222` / #454 — PASS, `211/211` tests plus typecheck, staging E2E syntax and Wrangler dry-run.
- Post-merge status convergence commit: `104248e1b3b4db39a7d379bc0f1d910b80a2eed3`.
- Status convergence CI: `33466120240` / #455 — PASS.

## Mandatory R2.7 attacks

The following are explicitly carried into R2.7 as adversarial cross-stage cases, not waived:

- provider failure after grounded multi-room selection must preserve R2.5 orchestration semantics and must not regress to the stale R2.4 “multi-room unsupported” fallback;
- natural guest phrasing such as `para dos` must not cause a redundant guest-count clarification when the party size is already semantically clear.

## Exit

R2.6 is `TECHNICAL_PASS / CLOSED`. `2.6.9-R2.7 — Adversarial QA + Independent Critic` is the active substage. Human Product Acceptance remains `REWORK`; R2.9 is the only human decision gate and Phase 3 / Alquileres stays blocked until explicit `ACCEPT`.
