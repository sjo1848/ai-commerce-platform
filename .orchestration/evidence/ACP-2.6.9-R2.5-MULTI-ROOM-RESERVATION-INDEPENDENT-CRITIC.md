# ACP 2.6.9-R2.5 — Independent Critic — Final Reclosure

Status: `INDEPENDENT_CRITIC_PASS`
Date: `2026-09-01`
PR: `#48`
Substantive Artifact A: `63e61e153222c77f44061840178d258c52a7875f`
QA reclosure: `.orchestration/reviews/ACP-2.6.9-R2.5-QA-RECLOSURE-V2.md`
Pre-Critic reclosure: `.orchestration/evidence/ACP-2.6.9-R2.5-MULTI-ROOM-RESERVATION-PRECRITIC-RECLOSURE.md`
Binding amendment: `.orchestration/contracts/ACP-2.6.9-R2.5-INDEPENDENT-CRITIC-AMENDMENT.md`
Reclosure head before this evidence: `d6302098cbda50da5e8934e1bdf4176ea164a583`
Reclosure CI: `33461503249` / run #437 — PASS

## Independent review

The critic reviewed R2.5 as an irreversible/distributed-mutation boundary and did not rely on the prior QA or Pre-Critic verdicts.

### Finding 1 — P1 cancellation-scope expansion through negation/exclusion

Risk confirmed:
- lexical whole-group matching could treat `No canceles todas, cancelá la primera reserva` as cancel-all;
- unsupported `Cancelá todas menos la primera` could also broaden to the whole group.

Frozen red evidence:
- `81fc71989aea292fca2ba89242f814229e4ccb63`;
- core-ci `33460930792` / run #429;
- `198/200 PASS`; both critic regressions failed.

Rework:
- `67699589b75ea9177cafa28600bc0d718d4b2705`;
- whole-group cancellation intent is classified server-side;
- negated group intent cannot authorize group scope;
- unsupported exclusions fail closed to clarification;
- specific booking grounding remains authoritative.

Verification:
- core-ci `33461089927` / run #430: `200/200 PASS`.

Finding status: `CLOSED`.

### Finding 2 — P1 unsafe automatic recovery after uncertain compensation

Risk confirmed:
- a compensation cancellation may have committed even if both responses are lost;
- replaying the original CREATE token proves historical creation, not current active state after that possible cancellation;
- replaying the whole CREATE plan could therefore claim a confirmed group containing a booking that is already cancelled.

Frozen red evidence:
- `5ece9105e6e9f28ae0e0cdddee1d515b256f559a`;
- core-ci `33461235722` / run #431;
- `200/201 PASS`; only the critic recovery-boundary regression failed.

Rework:
- adapter marks uncertain compensation `automaticRecoveryAllowed=false`;
- webchat returns manual reconciliation with no recovery approval token;
- primary mutation uncertainty retains bounded exact-plan recovery;
- webchat boundary is frozen by a separate regression.

Final substantive verification:
- Artifact A `63e61e153222c77f44061840178d258c52a7875f`;
- core-ci `33461399664` / run #434: `202/202 PASS`;
- TypeScript/typecheck: PASS;
- staging E2 runner syntax: PASS;
- Wrangler dry-run: PASS.

Finding status: `CLOSED`.

## Final invariant review

- LLM still has no authority over tenant/hotel/actor/guest identity, approval metadata, root/child operation tokens, ownership or arbitrary tool selection: PASS
- multi-room create rooms/dates are server-grounded before approval: PASS
- exact approved plan is revalidated server-side before mutation: PASS
- Policy + HITL remain mandatory for reservation/cancellation writes: PASS
- Core idempotency remains session-scoped and cross-session replay fails closed: PASS
- HMS remains transactional source of truth: PASS
- distributed failure/compensation outcomes are never represented as atomic: PASS
- primary uncertainty and compensation uncertainty now have distinct safe recovery semantics: PASS
- irreversible cancellation scope cannot broaden from negated/ambiguous/subset language: PASS
- prior single-room and R2.4 behavior remains covered by the full suite: PASS
- production, payments, paid expansion, WhatsApp requirement and second vertical remain unauthorized: PASS

## Severity gate

Open P0: `0`
Open P1: `0`
Open P2: `0`

Verdict: `INDEPENDENT_CRITIC_PASS`.

Merge is authorized only after this evidence commit itself has green exact-head CI. After merge, R2.5 still requires post-merge main regression and state/tracker convergence before `TECHNICAL_PASS / CLOSED`.
