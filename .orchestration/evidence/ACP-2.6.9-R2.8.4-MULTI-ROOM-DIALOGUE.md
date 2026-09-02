# ACP 2.6.9-R2.8.4 — Natural Multi-Room Dialogue Evidence

Status: `MULTI_ROOM_DIALOGUE_PASS / FINAL CLOSURE PENDING`
Date: `2026-09-01`
Scope: natural real-model multi-room dialogue through the unconsumed HITL boundary only. No approval was consumed and no reservation/cancellation mutation executed.

## Current gate position

R2.8.4 is not considered integrated yet. The product defect and the later stochastic route flake have both been frozen and repaired, and the latest functional staging run is GREEN. Because an earlier exact-head run exposed flakiness after an apparently successful run, final closure now requires two consecutive post-repair exact-head real-model GREEN runs, followed by PR/core-ci, merge and post-merge `main` CI.

Accepted behavior remains:
- C06 establishes four guests + the readiness-approved synthetic stay window;
- 101 and 102 are authoritative HMS candidates;
- C07 `Quiero reservar la 101 y la 102.` is one multi-room intent;
- the real model reaches `hms.createMultiReservation` and Policy/HITL returns `APPROVAL_REQUIRED`;
- the challenge is not consumed in this block;
- no single-room collapse, deterministic route fallback or HMS write succeeds.

## RED 1 — stale R2.4 behavior in real staging

Head: `6c96409ccb819140198a8f6136c2c4597aa35bc9`
Run: `33523155016` — **FAIL**
Foundation: **218/218 PASS**
Artifact: `9806560462`
ZIP SHA-256: `86396e38b6d8b17b141d59820485d9e0efa3ef5785daac582d4ca6a556180290`

Observed:
1. C06 returned authoritative 101 + 102.
2. C07 preserved the selection but returned only `Perfecto, lo tengo.`
3. `Perfecto, reservá esas dos.` still failed to reach HITL.
4. No mutation occurred.

This proved the historical R2.4 limitation was still perceptible in the real model path.

## RED 2 — frozen prompt-contract regression

Commit: `4bc2d933101f1e8112cd8f8e5005c26b02244fdc`
Run: `33523570624` — **EXPECTED RED**
Foundation: **218/219 PASS / 1 FAIL**

The single regression proved:
- no capability-specific rule existed for `hms.createMultiReservation`;
- stale text still said `Core blocks multi-room side effects until R2.5`.

## Fix 1 — current composite capability in the LLM planner

Commit: `ccdb424c1ed619c957f6228f030644c6203cb67a`

Bounded changes in `src/core/llm-model.ts`:
- single-room and multi-room reservation capabilities are explicit;
- `Quiero reservar la 101 y la 102` and `reservá esas dos` are explicit planner examples;
- selected room IDs and dates remain server-grounded;
- stale R2.4 blocking text was removed;
- complete multi-room selection is protected from redundant selection clarification.

No HMS adapter, Policy Engine, approval authority, canonical fingerprinting, idempotency, ownership or execution boundary was loosened.

First GREEN after Fix 1:
- run `33523772528` — **PASS**
- foundation **219/219 PASS**
- C06/C07 path **5/5 PASS**
- 2 route inferences / 0 route fallbacks
- `hms.createMultiReservation` → `approval_required`
- no mutation
- artifact `9806805221`
- ZIP SHA-256 `97d5ece5c195c38536f70f79a59d76bc103de49b6292c7048abaeeb6fa53014b`
- E2E p95 `9,105 ms`.

That GREEN was not sufficient to close the gate.

## RED 3 — exact-head stochastic route flake invalidated the first closure

Exact-head: `92b6f1f8702508e65d2595fff4784c3924821145`
Run: `33524057086` — **FAIL**
Foundation/deploy: PASS

C06 remained correct. On C07 the real model produced a contradictory tool candidate that Core safely rejected as `invalid_tool_plan_shape`; the conversation degraded before the follow-up wording reached the composite HITL boundary. No mutation occurred.

Verdict: safety was preserved, but product reliability was not good enough. R2.8.4 returned to bounded REWORK instead of accepting a lucky GREEN.

## RED 4 — frozen bounded-repair regression

Regression commit: `a3032bd4f847d6309481820287bdeb991fe48b83`
Run: `33524360119` — **EXPECTED RED**

The regression simulates the exact failure class: the model chooses `hms.createMultiReservation` while contradicting itself by marking already-grounded room/date fields missing. Expected behavior is one bounded model re-inference before deterministic fallback.

The pre-fix router failed this regression at foundation, as intended.

## Fix 2 — one bounded real-model route repair

Commit: `18a2f7383fa44d79ce9eb840f933557de4b8b7c1`

The router now permits exactly one repair inference only when the first model candidate reaches the `invalid_tool_plan_shape` branch.

Repair properties:
- same provider/model;
- label `agent_core_route_repair`;
- same JSON schema;
- same current user request and current server-visible conversational state;
- prior invalid candidate is treated as data, never instructions;
- no deterministic filling of room IDs, dates or other business facts;
- repaired output must again pass trusted-field, shape, visible-tool, schema and bounded-input validation;
- repair failure still falls through to the existing deterministic safe fallback.

This does not weaken Tool Registry, Policy/HITL, canonicalization, idempotency, ownership or HMS authority.

## Post-repair functional GREEN

Head: `18a2f7383fa44d79ce9eb840f933557de4b8b7c1`
Run: `33524686427` — **SUCCESS**
Foundation: **220/220 PASS**
Worker version: `1610da50-5416-4ed3-b755-03b2d9a826d7`
Artifact: `9807177922`
ZIP SHA-256: `a6d929ef32d9b2fa501cb8b1a8e49a97e21dc9485ad46adda72dd834a537496e`

Real staging report:
- `ACP_R2_8_MULTI_ROOM_DIALOGUE_PASS`
- **5/5 PASS**
- requests: `2`
- E2E p95: `8,607 ms`
- approval challenge reached: `true`
- approval consumed: `false`
- HMS mutation requests: `0`.

C07 reached `hms.createMultiReservation` → `APPROVAL_REQUIRED` directly with no redundant question and no single-room collapse.

### Important repair-proof distinction

This GREEN did **not** need the runtime repair path. Telemetry for the session contained two normal `agent_core_route` inferences and zero route fallbacks; there was no `agent_core_route_repair` inference.

Therefore evidence is intentionally split:
- deterministic regression RED→GREEN proves the bounded repair path itself;
- real staging proves the normal C06/C07 path remains correct and reaches composite HITL without fallback.

The record must not claim the staging run exercised repair when it did not.

## Audit / safety proof

Post-repair staging audit contained only:
- `hms.checkAvailability` — `allowed`;
- `hms.checkAvailability` — `succeeded`;
- `hms.createMultiReservation` — `approval_required`.

No reservation/cancellation mutation had `succeeded` or `replayed` status.

`approvalConsumed: false`
`hmsMutationRequests: 0`

## Explicit carry into R2.8.5

The unconsumed challenge still renders canonical UUIDs:
`Confirmar reserva de 2 habitaciones (<canonical room UUID>, <canonical room UUID>) del 2030-01-01 al 2030-01-03.`

`approvalSummaryHasUuid: true`.

This is **not accepted as C09 / CREATE_PASS evidence**. R2.8.5 must present server-grounded human-readable room numbers such as `101` and `102` before approval is consumed, while the canonical plan/fingerprint may continue to use UUIDs internally.

## Quality carry into R2.8.7

Observed R2.8.4 E2E p95 values remain high (`9,105 ms` before the exact-head flake and `8,607 ms` after Fix 2). Latency remains an explicit product-quality item.

## Final closure criterion

Before `MULTI_ROOM_DIALOGUE_PASS / CLOSED`:
1. two consecutive post-repair exact-head real-model runs must be GREEN;
2. 220/220 foundation must remain GREEN;
3. deterministic route fallbacks on the exact C06/C07 session must remain zero;
4. no HMS reservation/cancellation mutation may succeed/replay;
5. PR exact-head core-ci must pass;
6. merge must be SHA-pinned;
7. post-merge `main` core-ci must pass.

Until those steps converge, R2.8.5 is **not active**.
