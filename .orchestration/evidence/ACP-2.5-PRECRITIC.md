# ACP 2.5 — Pre-Critic Evidence

Substantive artifact: `cec61660187969923da7ae34af524b094e9e762d`
Accepted E1 base ancestry: `43b9d75371ed29604509537dac898e059534fbcb` (`acceptance/staging`)
Contract: `.orchestration/contracts/ACP-2.5-CONTROLLED-RESERVATION.md`
Scope: AI Commerce Platform controlled reservation flow against HMS staging only.

## Exact executable gate
GitHub Actions run `33289958425`, job `foundation` (`99199742638`) — SUCCESS on exact artifact `cec61660187969923da7ae34af524b094e9e762d`.

The workflow definition on that artifact performs:
1. `npm ci`
2. `npm run qa` → generated Worker types + TypeScript typecheck + build + all `test/*.test.mjs`
3. `npx wrangler deploy --dry-run`

## Invariant classification
| Invariant | Result | Evidence surface |
|---|---|---|
| `I-01` | PASS | fixed deployment tenant; handler ignores tenant override when configured; trusted tenant route in Worker. |
| `I-02` | PASS / inherited | session creation and Durable Object session store remain canonical; approval requires existing session. |
| `I-03` | PASS / inherited | model routes only tenant-visible registered tools. |
| `I-04` | PASS | `PolicyEngine` evaluates before validation/execution; create/cancel policies are `approval`. |
| `I-05` | PASS | side-effect executor requires idempotency key; reservation adapter marks downstream idempotency. |
| `I-06` | PASS / inherited | executor records denied/approval-required/allowed/failed/succeeded/replayed audit states. |
| `I-07` | PASS | all HMS read/write access is behind `HmsServiceBindingAdapter`; Core contains no D1/booking persistence. |
| `I-08` | PASS | HMS INTERNAL_ERROR maps to generic Core tool failure; unhandled webchat errors are generic. |
| `I-09` | PASS | HMS quote/reservation contracts use integer `*Cents` fields. |
| `I-10` | PASS | exact artifact is feature-branch code/config only; no production deployment executed by CI. |
| `ACP25-AUTH-001` | PASS | forged approval header test; policy requires internal `humanApproved` execution metadata. |
| `ACP25-HITL-001` | PASS | approval fingerprint binds session/tenant/actor/message/idempotency key. |
| `ACP25-HITL-002` | PASS | durable approval challenge is expiring and deleted on successful serialized Durable Object consume; single-use test. |
| `ACP25-IDEMP-001` | PASS | approval route requires idempotency; adapter derives HMS operation token exclusively from trusted execution metadata. |
| `ACP25-IDEMP-002` | PASS | create/cancel tools use `idempotencyMode: downstream`; replay test confirms Core calls HMS again so HMS remains authoritative. |
| `ACP25-TENANT-001` | PASS | fixed tenant + actor in Worker and server-side tenant→Hotel Norte route; forged actor test. |
| `ACP25-BOUNDARY-001` | PASS | Service Binding RPC is the only HMS integration path in the 2.5 adapter. |
| `ACP25-CLEANUP-001` | PASS at Core boundary | cancel tool is separately approval-gated and forwards trusted token + booking id; HMS-side token ownership remains a downstream gate. |
| `ACP25-ERROR-001` | PASS | normalized RPC→Core error mapping; no raw INTERNAL_ERROR message exposed. |
| `ACP25-SCOPE-001` | PASS | Worker target remains staging contract; no payments/production/real-data mutation is introduced. |
| `ACP25-EVID-001` | PENDING CRITIC | exact CI is green, but Independent Critic PASS is still required before technical promotion. |

## Adversarial coverage in exact artifact
`test/reservation-control.test.mjs` covers:
- no mutation before explicit approval;
- forged ordinary-chat approval header cannot bypass policy;
- approval requires an existing session;
- approval requires server-issued challenge;
- approval requires same idempotency key;
- challenge is bound to message + idempotency key;
- challenge is single-use;
- forged actor headers do not alter trusted actor/hotel identity;
- user text cannot inject operation metadata;
- downstream idempotency replays remain visible to HMS;
- cancel requires internal approval metadata;
- deterministic model can request reserve/cancel intent but cannot produce execution metadata.

## Explicitly unclaimed
This evidence does not claim:
- HMS 2.5 Independent Critic PASS;
- deployment of the new write capability to staging;
- cross-repository synthetic E2E;
- production readiness;
- market validation.

## Pre-Critic verdict
`READY_FOR_INDEPENDENT_CRITIC` for substantive artifact `cec61660187969923da7ae34af524b094e9e762d`.
