# ACP 2.6.9-R2.8.4 — Natural Multi-Room Dialogue Evidence

Status: `MULTI_ROOM_DIALOGUE_PASS / PASS`
Date: `2026-09-01`
Scope: natural real-model multi-room dialogue through the unconsumed HITL boundary only. No approval was consumed and no reservation/cancellation mutation executed.

## Gate result

R2.8.4 closes **PASS** after a frozen RED → bounded router rework → exact real-model staging GREEN sequence.

The accepted behavior is:
- C06 establishes a fresh four-guest stay on the readiness-approved synthetic window;
- room numbers 101 and 102 are visible from authoritative HMS staging;
- C07 `Quiero reservar la 101 y la 102.` is interpreted as one exact multi-room reservation intent;
- the real LLM route reaches `hms.createMultiReservation` and external Policy/HITL returns `APPROVAL_REQUIRED`;
- the approval token is deliberately **not consumed** in R2.8.4;
- no single-room collapse occurs;
- no deterministic route fallback is used on the multi-room path;
- no HMS create/cancel side effect occurs.

C08 occupancy clarification was not required by the current canonical state; C07 reached the correct composite HITL boundary directly.

## Frozen real-model RED

Initial diagnostic head:
`6c96409ccb819140198a8f6136c2c4597aa35bc9`

Workflow:
- run: `33523155016` — **FAIL**
- foundation: **218/218 PASS**
- artifact ID: `9806560462`
- artifact ZIP SHA-256: `86396e38b6d8b17b141d59820485d9e0efa3ef5785daac582d4ca6a556180290`

Observed transcript:
1. C06 passed and returned authoritative 101 + 102 availability.
2. C07 `Quiero reservar la 101 y la 102.` returned only `Perfecto, lo tengo.`
3. Historical probe `Perfecto, reservá esas dos.` returned `Decime qué necesitás para la estadía y sigo desde los datos que ya tenemos.`
4. No HITL challenge was reached and no mutation executed.

Verdict: real product failure against the frozen historical-R2.4 probe; the conversation could preserve selection but the real model path did not progress into the already-authorized R2.5 composite capability.

## Frozen prompt-contract RED

Regression commit:
`4bc2d933101f1e8112cd8f8e5005c26b02244fdc`

Workflow run:
`33523570624` — **EXPECTED RED**

Foundation result:
- tests: **218/219 PASS / 1 FAIL**;
- only failing regression: `R2.8.4 router prompt advertises current composite multi-room capability and removes stale R2.4 blocking text`.

The frozen prompt evidence showed both defects explicitly:
- no capability-specific rule for `hms.createMultiReservation`;
- stale instruction: `Core blocks multi-room side effects until R2.5`.

## Bounded fix

Product fix commit:
`ccdb424c1ed619c957f6228f030644c6203cb67a`

Changed only the planning contract in `src/core/llm-model.ts` plus the frozen regression test:
- `hms.createReservation` is now explicitly single-room;
- `hms.createMultiReservation` is explicitly the current multi-room reservation capability;
- selected room IDs/dates remain server-grounded and are not exposed as model-authoritative inputs;
- stale R2.4 blocking text was removed;
- examples now cover `Quiero reservar la 101 y la 102` and `reservá esas dos`;
- a complete grounded multi-room selection is protected from redundant room/selection clarification.

No HMS adapter, Policy Engine, approval authority, canonical fingerprinting, idempotency, ownership or mutation execution boundary was loosened.

## Exact real-model GREEN

Fixed head:
`ccdb424c1ed619c957f6228f030644c6203cb67a`

Workflow:
- name: `R2.8 multi-room dialogue`
- run: `33523772528` / run #3
- conclusion: **SUCCESS**
- foundation: **219/219 PASS**
- Wrangler dry-run/deploy: PASS
- deployed worker version: `5de48802-783c-4bd9-b0ed-4a85a12b1d44`
- artifact: `r2.8-multi-room-dialogue-33523772528`
- artifact ID: `9806805221`
- artifact ZIP SHA-256: `97d5ece5c195c38536f70f79a59d76bc103de49b6292c7048abaeeb6fa53014b`

Authorized model observed:
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`

Staging report:
- `ACP_R2_8_MULTI_ROOM_DIALOGUE_PASS`
- cases: **5/5 PASS**
- requests: 2
- E2E p95: `9,105 ms`
- reached approval challenge: `true`
- approval consumed: `false`
- HMS mutation requests: `0`

### C06 — fresh multi-room setup — PASS

Guest:
`Hola. Somos cuatro y queremos quedarnos del 1 al 3 de enero de 2030. ¿Qué tenés disponible?`

Authoritative HMS result included room numbers:
`101`, `102`, `103`, `203`.

Durable requested guests: `4`.
Window: `2030-01-01` → `2030-01-03`.

### C07 — exact 101 + 102 reservation intent — PASS

Guest:
`Quiero reservar la 101 y la 102.`

Result:
- HTTP `409`;
- `APPROVAL_REQUIRED`;
- exact composite tool in audit: `hms.createMultiReservation`;
- no `hms.createReservation` collapse;
- no create side effect;
- no re-question of dates or guest count.

### C08 — occupancy — not required

The current canonical multi-room plan did not require a separate occupancy clarification. This is permitted by the frozen corpus when the resulting canonical path is unambiguous. R2.8.4 therefore did not invent or add an unnecessary occupancy turn.

## Real-model proof

Telemetry for the exact multi-room session:
- model route inferences: `2`;
- route fallbacks: `0`;
- total model inferences including grounded response: `3`;
- exact model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`;
- total input tokens: `6,744`;
- total output tokens: `266`;
- model inference p95: `4,343 ms`;
- estimated model cost: `$0.00257529`.

This closes the historical R2.4 wording probe with **real-model** evidence rather than deterministic fallback evidence.

## Audit / safety proof

Audit for the exact session contained:
- `hms.checkAvailability` — `allowed`;
- `hms.checkAvailability` — `succeeded`;
- `hms.createMultiReservation` — `approval_required`.

It contained no successful/replayed reservation or cancellation mutation.

`approvalConsumed: false`
`hmsMutationRequests: 0`

Therefore R2.8.4 proves dialogue-to-HITL routing only; it does not claim create success.

## Explicit carry into R2.8.5

The unconsumed challenge currently renders:
`Confirmar reserva de 2 habitaciones (<canonical room UUID>, <canonical room UUID>) del 2030-01-01 al 2030-01-03.`

`approvalSummaryHasUuid: true`.

This is **not accepted as C09 / CREATE_PASS evidence**. C09 requires human-readable room identification when room numbers are available. R2.8.5 must fix/prove a summary such as rooms `101` and `102` before approval is consumed.

The UUID summary does not invalidate C07 because the guest selected rooms naturally as `101` + `102` and was never required to provide UUIDs; it is an explicit HITL UX defect at the next block boundary.

## Quality carry into R2.8.7

R2.8.4 E2E p95 was `9,105 ms`, consistent with the latency concern already observed in R2.8.3. It remains a Product Quality Review item and is not hidden by the successful dialogue gate.

## Verdict

`MULTI_ROOM_DIALOGUE_PASS / PASS`

Next authorized block after integration and post-merge verification only:
`R2.8.5 — HITL + create`.
