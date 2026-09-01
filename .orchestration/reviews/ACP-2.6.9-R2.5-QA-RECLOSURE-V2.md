# ACP 2.6.9-R2.5 — QA Reclosure V2

Status: `QA PASS — RECLOSED AFTER INDEPENDENT CRITIC REWORK`
Date: `2026-09-01`
PR: `#48`
Substage: `2.6.9-R2.5 — Multi-Room Reservation Orchestration`
Substantive Artifact A: `63e61e153222c77f44061840178d258c52a7875f`
Contract amendment: `.orchestration/contracts/ACP-2.6.9-R2.5-INDEPENDENT-CRITIC-AMENDMENT.md`

## Independent Critic findings incorporated into QA

### P1 — negated/exclusion cancellation scope could broaden an irreversible mutation

Frozen red evidence:
- test commit `81fc71989aea292fca2ba89242f814229e4ccb63`;
- core-ci `33460930792` / run #429;
- `198/200 PASS`; both new critic regressions failed as expected.

Unsafe examples:
- `No canceles todas, cancelá la primera reserva` could select the full group because lexical `todas` won before the specific reference.
- `Cancelá todas menos la primera` could be treated as cancel-all even though subset exclusion is not representable by R2.5.

Rework:
- server-side cancellation scope is classified as `all`, `not_all`, `subset_exclusion`, or `none`;
- negated whole-group scope cannot authorize group cancellation;
- subset/exclusion scope fails closed to clarification;
- specific server-grounded room/ordinal resolution remains authoritative.

Verification:
- fix commit `67699589b75ea9177cafa28600bc0d718d4b2705`;
- core-ci `33461089927` / run #430: `200/200 PASS`.

Finding status: `CLOSED`.

### P1 — uncertain compensation was incorrectly eligible for whole-plan automatic recovery

Frozen red evidence:
- test commit `5ece9105e6e9f28ae0e0cdddee1d515b256f559a`;
- core-ci `33461235722` / run #431;
- `200/201 PASS`; only the new uncertain-compensation recovery regression failed.

Risk:
- compensation cancellation may commit while both responses are lost;
- replay of the original CREATE token proves the historic create result but not current active state after the possibly committed cancellation;
- whole-plan CREATE recovery could therefore claim a confirmed booking that is actually cancelled.

Rework:
- the adapter marks uncertain compensation `automaticRecoveryAllowed=false`;
- webchat treats that classification as manual reconciliation and emits no recovery approval token;
- primary mutation `OUTCOME_UNKNOWN` retains the existing exact-plan automatic recovery behavior;
- a webchat regression proves the manual-only classification cannot accidentally enter the automatic recovery loop.

Verification boundary:
- adapter fix `1bd288f5e94a92c77231423c609a2211d6524676`;
- webchat boundary + regression head `63e61e153222c77f44061840178d258c52a7875f`;
- core-ci `33461399664` / run #434: `202/202 PASS`;
- TypeScript/typecheck: PASS;
- staging E2 runner syntax: PASS;
- Wrangler dry-run: PASS.

Finding status: `CLOSED`.

## Full severity gate

All earlier QA and Pre-Critic findings remain closed, including booking↔room grounding, stale explicit room retarget prevention, and session-scoped Core idempotency.

Open P0: `0`
Open P1: `0`
Open P2: `0`

QA verdict: `PASS / RECLOSED AFTER INDEPENDENT CRITIC REWORK`.

Because substantive code changed after the original Pre-Critic artifact, a fresh Pre-Critic reclosure is required before the Independent Critic can issue its final PASS.
