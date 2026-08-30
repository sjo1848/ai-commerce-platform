# ACP 2.5 — Pre-Critic Evidence

Substantive artifact: `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`
Accepted E1 base ancestry: `43b9d75371ed29604509537dac898e059534fbcb` (`acceptance/staging`)
Contract: `.orchestration/contracts/ACP-2.5-CONTROLLED-RESERVATION.md`
Scope: AI Commerce Platform controlled reservation flow against HMS staging only.

## Exact executable gate
GitHub Actions `core-ci` run `33290428385`, job `foundation` (`99200983748`) — SUCCESS on exact substantive artifact `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`.

That exact job completed:
1. locked dependency installation;
2. generated Worker types / typecheck / build / all Node tests through the repository QA script;
3. Cloudflare Worker configuration validation / Wrangler dry-run.

## Rework incorporated before this freeze
The previous artifact `cec61660187969923da7ae34af524b094e9e762d` is superseded. Final artifact `3d1a083...` additionally closes:
- HITL integrity: approval is now tied to the exact validated tool + arguments, not merely the message. Rerouting after approval fails closed and invalid plans cannot receive a challenge.
- Cleanup ownership: successful create stores the original trusted create token against session + tenant + actor + booking; deployed Worker uses the per-session Durable Object store.
- Cancellation token correctness: a later cancellation may have a new request idempotency key, but HMS receives only the stored original create token. Missing ownership fails closed.
- Replay observability: downstream HMS `replayed: true` is audited by Core as `replayed` with `downstream_authoritative_replay` detail.

## Invariant classification
| Invariant | Result | Evidence surface |
|---|---|---|
| `I-01` | PASS | fixed deployment tenant; trusted route and actor configuration. |
| `I-02` | PASS / inherited | canonical session manager + Durable Object session storage; approval requires existing session. |
| `I-03` | PASS / inherited | model routes only tenant-visible registered tools. |
| `I-04` | PASS | policy remains authoritative; create/cancel are `approval`. |
| `I-05` | PASS | every side-effect request requires idempotency metadata. |
| `I-06` | PASS | denied/approval/failed/succeeded/replayed states are auditable; downstream replay now emits `replayed`. |
| `I-07` | PASS | HMS integration remains behind `HmsServiceBindingAdapter`; no HMS persistence in Core. |
| `I-08` | PASS | RPC/internal errors are normalized. |
| `I-09` | PASS | money fields remain integer cents. |
| `I-10` | PASS | no production or paid-resource action in this increment. |
| `ACP25-AUTH-001` | PASS | forged approval headers cannot bypass policy. |
| `ACP25-HITL-001` | PASS | challenge stores exact operation SHA-256 in addition to request/session binding. |
| `ACP25-HITL-002` | PASS | challenge expires and is single-use in per-session DO; in-memory adversarial equivalent is covered in exact QA. |
| `ACP25-HITL-003` | PASS | stateful rerouting test changes room after approval and receives FORBIDDEN with zero HMS calls; invalid side effect is BAD_REQUEST with no challenge. |
| `ACP25-IDEMP-001` | PASS | create token derives only from trusted request idempotency metadata. |
| `ACP25-IDEMP-002` | PASS | downstream mode calls HMS on replay so HMS remains authoritative. |
| `ACP25-AUDIT-001` | PASS | exact test asserts terminal audit sequence `succeeded`, then `replayed` and detail `downstream_authoritative_replay`. |
| `ACP25-TENANT-001` | PASS | tenant/hotel/actor are server-pinned; forged actor cannot alter HMS context. |
| `ACP25-BOUNDARY-001` | PASS | Service Binding is the HMS boundary. |
| `ACP25-CLEANUP-001` | PASS | adapter binds successful booking to original create token in trusted `ReservationOperationStore`. |
| `ACP25-CLEANUP-002` | PASS | lifecycle test creates with `original-create-token`, cancels with `new-cancel-key`, and asserts HMS receives the original token; unowned cancellation fails closed. |
| `ACP25-CLEANUP-003` | PASS at deployment boundary | Worker wires `DurableObjectReservationOperationStore` over `SESSIONS`; operation token is server-side data and not model/user input. |
| `ACP25-ERROR-001` | PASS | normalized RPC→Core errors; no raw internal detail exposed. |
| `ACP25-SCOPE-001` | PASS | staging synthetic scope only; no payment/production/real-data/paid expansion. |
| `ACP25-EVID-001` | PENDING CRITIC | exact CI is green; fresh Independent Critic PASS is still required before promotion. |

## Adversarial coverage in exact artifact
`test/reservation-control.test.mjs` covers:
- no mutation before approval and forged headers cannot bypass it;
- existing-session/challenge/idempotency requirements;
- message/key binding and single-use challenge;
- exact-operation binding with stateful reroute after approval;
- invalid planned mutation rejected before challenge issuance;
- actor pinning and user inability to inject operation token;
- downstream HMS replay visibility and replay audit status;
- original create-token ownership and later cancellation with a distinct cancellation key;
- fail-closed cancellation without trusted ownership;
- deterministic model cannot emit trusted execution metadata.

## Explicitly unclaimed
This evidence does not claim:
- fresh Independent Critic PASS on artifact `3d1a083...`;
- HMS 2.5 final Critic PASS;
- deployment of the write capability to staging;
- cross-repository synthetic E2E;
- production readiness or market validation.

## Pre-Critic verdict
`READY_FOR_INDEPENDENT_CRITIC` for substantive artifact `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`.
