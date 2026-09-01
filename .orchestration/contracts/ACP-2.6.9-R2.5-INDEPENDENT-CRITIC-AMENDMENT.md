# ACP 2.6.9-R2.5 — Independent Critic Safety Amendment

Status: `AUTHORIZED / BINDING`
Date: `2026-09-01`
Parent contract: `.orchestration/contracts/ACP-2.6.9-R2.5-MULTI-ROOM-RESERVATION.md`
PR: `#48`

This amendment is additive and authoritative for R2.5. It freezes the two safety invariants exposed by the fresh Independent Critic after the original Pre-Critic gate.

## 1. Cancellation scope cannot expand through negation or exclusion

For irreversible cancellation, lexical presence of group words (`todas`, `todos`, `ambas`, `las dos`, `todo el grupo`, etc.) is not sufficient to authorize whole-group scope.

Required behavior:
- `No canceles todas, cancelá la primera reserva` must resolve the explicit specific booking and must not expand to the group.
- `No canceles todas` means the user explicitly rejected whole-group scope; if no specific booking is grounded, ask for clarification.
- subset/exclusion expressions such as `cancelá todas menos la primera`, `todas excepto la 101`, or equivalent are not representable by the current R2.5 mutation model and must fail closed to clarification.
- negated, contradictory, ambiguous, or unsupported scope must never create an approval challenge for a broader cancellation than the user unambiguously requested.
- specific room/ordinal grounding remains server-owned and has precedence once whole-group scope has been rejected.

## 2. Uncertain compensation is manual-reconciliation only

`OUTCOME_UNKNOWN` is phase-sensitive.

Automatic exact-plan recovery remains allowed when uncertainty belongs to the primary approved mutation and replaying the same plan/token is sufficient to determine the authoritative result.

Automatic recovery is **not** allowed when uncertainty occurs while compensating a previously created child after a definitive later failure.

Reason:
- the compensation cancellation may already have committed even when both responses were lost;
- replaying the original child CREATE token can prove the historical create result, but cannot prove that the booking remains active after a possibly committed compensation;
- therefore replaying the whole original CREATE plan could fabricate a `confirmed` group containing a booking that is already cancelled.

Required behavior:
- uncertain compensation raises `OUTCOME_UNKNOWN` marked server-side as `automaticRecoveryAllowed=false`;
- webchat returns HTTP 503 with `manualReconciliationRequired=true` and no `recoveryApprovalToken`;
- the model/request cannot set or override this recovery classification;
- no later child mutation starts after uncertain compensation;
- manual reconciliation must inspect HMS authoritative current state before any new reservation attempt.

## Acceptance regressions

The following regressions are mandatory and permanent:
1. negated all-group language cannot override an explicit specific cancellation;
2. unsupported all-except-one scope clarifies with no approval and no side effect;
3. compensation that may have committed while both responses are lost produces `OUTCOME_UNKNOWN` with automatic recovery disabled;
4. webchat never issues a recovery approval for a manual-reconciliation `OUTCOME_UNKNOWN`;
5. previously valid primary-mutation exact-plan recovery remains supported and bounded by the existing server-owned recovery-depth gate.

These invariants do not authorize production, payments, a second vertical, or any weakening of Policy/HITL/idempotency/ownership/HMS authority.
