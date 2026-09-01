# ACP 2.6.9-R2.7 — Adversarial QA + Independent Critic Closure

Status: `TECHNICAL_PASS / PENDING INTEGRATION`

## Scope

R2.7 re-attacks the accumulated Natural Receptionist behavior and deterministic safety boundary after R2.6. It does not authorize production, payments, broader autonomous writes or a second vertical.

Contract: `.orchestration/contracts/ACP-2.6.9-R2.7-ADVERSARIAL-QA.md`
QA: `.orchestration/reviews/ACP-2.6.9-R2.7-QA.md`
PR: #51 — `test(2.6.9-R2.7): adversarial QA and cross-stage hardening`

## Frozen substantive artifact

`363c1937d17e71a09e513707185a127332a792ec`

Final substantive CI: #463 / `33468363790`
- `216/216 PASS`;
- typecheck PASS;
- staging E2 runner syntax PASS;
- Wrangler dry-run PASS.

## Red → green falsification record

### RED #457 / `33467426308`
Fresh cross-stage tests demonstrated:
- provider failure regressed grounded multi-room intent toward the stale R2.4 fallback;
- natural `habitaciones para dos` was not reliable user-owned guest memory.

### Rework / GREEN #460 / `33467815488`
Closed provider-failure composite routing, colloquial `reservame` fallback recognition and natural party-size grounding. Full suite reached `215/215 PASS`.

### Fresh RED #461 / `33467984755`
Adversarial QA then broke the new party-size rule with `habitaciones para dos noches`: duration could be mistaken for `guests=2`.

### Final rework / GREEN #463
Party-size inference now excludes immediate duration/unit nouns while retaining independent availability intent. Full suite reached `216/216 PASS`.

## Review gates

- QA — `PASS / RECLOSED`; exact QA evidence head `e243d7fa216b430bdba9ccac400ee96c12b3e6c0`; CI #464 / `33468438376` PASS.
- Pre-Critic review `5073907311` — **PASS**.
- Independent Critic review `5073910176` — **PASS**.
- Open findings: `P0/P1/P2 = 0/0/0`.

## Closed R2.7 invariants

- provider failure cannot collapse grounded multi-room intent into the single-room reservation tool;
- fallback can propose the visible composite tool, but Core still owns ambiguity checks and canonical room/date grounding;
- natural `habitaciones para dos/2` is durable user-owned party-size memory;
- duration phrasing such as `dos noches` cannot fabricate a guest count;
- prompt/tool/trusted-field injection remains fail-closed;
- tenant/hotel/actor/guest identity remains server-authoritative;
- stale approvals/inventory and ambiguous room occupancy still block writes;
- group ownership, session-scoped idempotency, cancellation scope and replay protections remain green;
- primary mutation uncertainty and uncertain compensation retain the bounded/manual recovery semantics closed in R2.5;
- response prose remains grounded and cannot introduce unauthorized payment/process facts.

## R2.8 carry-forward

The normal LLM prompt still contains historical R2.4 wording about multi-room execution being blocked until R2.5. This does not weaken the execution authority boundary, but it may affect real-model behavior. R2.8 must explicitly prove natural-model multi-room discovery/selection/reservation rather than relying on R2.7 fallback evidence.

## Exit condition

R2.7 becomes `TECHNICAL_PASS / CLOSED` only after this PR integrates and post-merge `main` CI passes. Until then R2.8 remains blocked. Human Product Acceptance remains `REWORK` until R2.9; Phase 3 / Alquileres remains blocked until explicit human `ACCEPT`.
