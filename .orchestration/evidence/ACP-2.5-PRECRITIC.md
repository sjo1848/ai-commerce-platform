# ACP 2.5 — Pre-Critic Evidence

Product artifact: `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`
Final staging-validation candidate: `98ede44ed97764c9835d818290167903686f3b4e`
Accepted E1 base ancestry: `43b9d75371ed29604509537dac898e059534fbcb` (`acceptance/staging`)
Contract: `.orchestration/contracts/ACP-2.5-CONTROLLED-RESERVATION.md`
Scope: AI Commerce Platform controlled reservation flow against HMS staging only.

## Exact executable gates

Product artifact `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`:
- `core-ci` run `33290428385`, job `foundation` (`99200983748`) — SUCCESS.

Final staging-validation candidate `98ede44ed97764c9835d818290167903686f3b4e`:
- push `core-ci` run `33293348911`, job `foundation` (`99208708217`) — SUCCESS;
- PR `core-ci` run `33293350619`, job `foundation` (`99208713346`) — SUCCESS.

The final candidate gates execute:
1. locked dependency installation;
2. repository QA / typecheck / tests;
3. syntax validation of `scripts/staging-e2e-reservation.mjs`;
4. Cloudflare Worker validation / Wrangler dry-run.

## Rework incorporated before this freeze

The previous artifact `cec61660187969923da7ae34af524b094e9e762d` is superseded. Product artifact `3d1a083...` closes:
- HITL integrity: approval is tied to the exact validated tool + arguments, not merely the message. Rerouting after approval fails closed and invalid plans cannot receive a challenge.
- Cleanup ownership: successful create stores the original trusted create token against session + tenant + actor + booking; deployed Worker uses the per-session Durable Object store.
- Cancellation token correctness: a later cancellation may have a new request idempotency key, but HMS receives only the stored original create token. Missing ownership fails closed.
- Replay observability: downstream HMS `replayed: true` is audited by Core as `replayed` with `downstream_authoritative_replay` detail.

Final staging-validation candidate `98ede44...` additionally prepares the acceptance/staging gate without deploying it:
- adds `scripts/staging-e2e-reservation.mjs`;
- wires it into `Deploy AI Commerce staging` after the inherited E1 availability/quote smoke;
- uses per-run synthetic future dates and per-run idempotency keys to avoid persistent-test collisions;
- requires server-side HITL challenge before every create/cancel attempt;
- asserts first create, authoritative HMS create replay, same-token/different-payload conflict, inventory removal, token-owned cancellation, authoritative cancellation replay, and restored availability;
- performs best-effort approved cleanup if a later assertion fails after a booking was created;
- does not execute on feature pushes: real E2E remains gated behind promotion to `acceptance/staging` after Independent Critic PASS.

## Invariant classification

| Invariant | Result | Evidence surface |
|---|---|---|
| `I-01` | PASS | fixed deployment tenant; trusted route and actor configuration. |
| `I-02` | PASS / inherited | canonical session manager + Durable Object session storage; approval requires existing session. |
| `I-03` | PASS / inherited | model routes only tenant-visible registered tools. |
| `I-04` | PASS | policy remains authoritative; create/cancel are `approval`. |
| `I-05` | PASS | every side-effect request requires idempotency metadata. |
| `I-06` | PASS | denied/approval/failed/succeeded/replayed states are auditable; downstream replay emits `replayed`. |
| `I-07` | PASS | HMS integration remains behind `HmsServiceBindingAdapter`; no HMS persistence in Core. |
| `I-08` | PASS | RPC/internal errors are normalized. |
| `I-09` | PASS | money fields remain integer cents. |
| `I-10` | PASS | no production or paid-resource action in this increment. |
| `ACP25-AUTH-001` | PASS | forged approval headers cannot bypass policy. |
| `ACP25-HITL-001` | PASS | challenge stores exact operation SHA-256 in addition to request/session binding. |
| `ACP25-HITL-002` | PASS | challenge expires and is single-use in per-session DO; in-memory adversarial equivalent is covered in exact QA. |
| `ACP25-HITL-003` | PASS | stateful rerouting after approval receives FORBIDDEN with zero HMS calls; invalid side effect is BAD_REQUEST with no challenge. |
| `ACP25-IDEMP-001` | PASS | create token derives only from trusted request idempotency metadata. |
| `ACP25-IDEMP-002` | PASS | downstream mode calls HMS on replay so HMS remains authoritative. |
| `ACP25-AUDIT-001` | PASS | exact test asserts `succeeded`, then `replayed` with `downstream_authoritative_replay`. |
| `ACP25-TENANT-001` | PASS | tenant/hotel/actor are server-pinned; forged actor cannot alter HMS context. |
| `ACP25-BOUNDARY-001` | PASS | Service Binding is the HMS boundary. |
| `ACP25-CLEANUP-001` | PASS | adapter binds successful booking to original create token in trusted `ReservationOperationStore`. |
| `ACP25-CLEANUP-002` | PASS | lifecycle test creates with original token, cancels with a distinct request key, and asserts HMS receives the original token; unowned cancellation fails closed. |
| `ACP25-CLEANUP-003` | PASS at deployment boundary | Worker wires `DurableObjectReservationOperationStore` over `SESSIONS`; operation token is server-side data and not model/user input. |
| `ACP25-E2E-001` | PREPARED / NOT EXECUTED | acceptance/staging workflow now encodes HITL create/replay/conflict/cancel/replay/restoration with cleanup; execution requires post-Critic promotion. |
| `ACP25-ERROR-001` | PASS | normalized RPC→Core errors; no raw internal detail exposed. |
| `ACP25-SCOPE-001` | PASS | staging synthetic scope only; no payment/production/real-data/paid expansion. |
| `ACP25-EVID-001` | PENDING CRITIC | final candidate CI is green; fresh Independent Critic PASS is still required before promotion. |

## Adversarial coverage in product artifact

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
- fresh Independent Critic PASS on candidate `98ede44...`;
- HMS 2.5 final Critic PASS;
- deployment of the write capability to staging;
- successful execution of `scripts/staging-e2e-reservation.mjs` against live staging;
- production readiness or market validation.

## Pre-Critic verdict

`READY_FOR_INDEPENDENT_CRITIC` for final candidate `98ede44ed97764c9835d818290167903686f3b4e`, whose product artifact is `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`.
