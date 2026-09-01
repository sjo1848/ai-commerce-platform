# ACP 2.6.9-R2.8.3 — Natural Read-Only Conversation Evidence

Status: `CONVERSATION_PASS / PASS`
Date: `2026-09-01`
Scope: real-model natural read-only conversation only. No approval, reservation or cancellation mutation was executed.

## Exact staging artifact

Staging-tested head:
`8b17a352d3b8d6b24b65cf4595d1a5c47aef40f4`

Workflow:
- name: `R2.8 read-only conversation`
- run: `33520967290` / run #1
- conclusion: **SUCCESS**
- artifact: `r2.8-readonly-conversation-33520967290`
- artifact ID: `9805694384`
- artifact ZIP SHA-256: `dac50a4b3929802635628d220dfb2c30b46f891d3e37250c6af55e3030315f7b`

Foundation on the same staging head:
- tests: **218/218 PASS**
- typecheck: PASS
- harness syntax: PASS
- Wrangler dry-run/deploy: PASS
- core-ci #481 / `33521108167`: PASS

Authorized model observed:
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`

## Frozen conversation cases

The real staging report returned `ACP_R2_8_CONVERSATION_PASS` with **6/6 PASS** and `hmsMutationRequests: 0`.

### C01 — greeting
Guest:
`Hola`

Visible assistant:
`¡Hola! Claro, decime en qué te puedo ayudar.`

Result:
- natural greeting;
- no capability-menu/tool-form behavior;
- no operational facts invented;
- no internal identifiers exposed.

### C02 — party size before dates
Guest:
`¿Tenés habitaciones para dos?`

Visible assistant:
`¿Para qué fechas sería?`

Result:
- durable semantic state retained `guests=2`;
- assistant did not ask guest count again;
- only the actually missing dates were requested.

### C03 — dates complete the stay
Guest:
`Del 1 al 3 de enero de 2030.`

Result:
- HMS `source=hms`, `truth=transactional`;
- exact interval `2030-01-01` → `2030-01-03`;
- remembered `requestedGuests=2`;
- authoritative availability returned room numbers 101, 102, 103 and 203;
- response exposed human room numbers/prices, not UUIDs or internal metadata.

The room metadata returned by HMS includes a room operational `status` field. Some future-available rooms may currently have `status=OCCUPIED`; interval availability remains authoritative because HMS resolves requested-date booking overlap separately. This is not treated as a contradiction between current room state and future inventory.

### C04 — natural date correction
Guest:
`Mejor corramos un día: del 2 al 4 de enero de 2030.`

Result:
- stale dates were superseded;
- exact new interval `2030-01-02` → `2030-01-04`;
- `requestedGuests=2` survived the correction;
- HMS availability was re-evaluated rather than reused from the old interval.

### C05 — ordinal quote
Fresh-session availability established the authoritative current room order. Guest then asked:
`¿Cuánto sale la primera?`

Result:
- `la primera` resolved server-side to the first authoritative availability candidate, room 101;
- HMS quote used the exact canonical room id internally;
- visible assistant did not expose that id;
- quote truth: ARS 20,000 total / 2 nights at ARS 10,000 nightly.

## No-mutation boundary

Audit evidence contained only read tools:
- `hms.checkAvailability`: 3 calls, each `allowed` + `succeeded`;
- `hms.getQuote`: 1 call, `allowed` + `succeeded`.

No audit event referenced:
- `hms.createReservation`;
- `hms.createMultiReservation`;
- `hms.cancelReservation`;
- `hms.cancelMultiReservation`.

No approval token, booking id or reservation mutation result appeared in the conversation corpus.

## Model / fallback / latency evidence

Observed model telemetry:
- model inferences: `10`;
- model fallbacks: `1`;
- fallback per inference: `1/10` (`10%`);
- fallback reason: `invalid_conversational_draft`;
- input tokens: `16,837`;
- output tokens: `801`;
- estimated cost: `USD 0.006737894`;
- provider/inference latency: min `1,117 ms`, median `2,470 ms`, p95/max `6,392 ms`;
- end-to-end conversation p95: `9,520 ms`.

The single fallback occurred while composing the C02 clarification. The rejected model draft did **not** degrade visible correctness: deterministic bounded rendering produced the natural and exact question `¿Para qué fechas sería?`, without re-asking guests.

The fallback is therefore not a blocker for `CONVERSATION_PASS`, but it remains explicit product-quality evidence for R2.8.7. The 9.52 s E2E p95 and mechanical room-enumeration style in availability responses are also carried into R2.8.7; they are not normalized away by this functional gate.

## Gate verdict

`CONVERSATION_PASS / PASS`

R2.8.3 demonstrates that the real deployed model/core can sustain the frozen read-only receptionist flow with durable memory, authoritative HMS grounding, correction handling and ordinal resolution without mutations.

Next authorized block only:
`R2.8.4 — Natural multi-room dialogue` → gate `MULTI_ROOM_DIALOGUE_PASS`.
