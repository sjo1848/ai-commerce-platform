# ACP 2.6.9-R2.4 — QA Reclosure after Independent Critic REWORK

Status: `QA PASS — NEW ARTIFACT A`
Date: `2026-08-31`
PR: `#46`

## Supersession

Prior Artifact A `35af379a5f6286c223fe0fe1f80b63f5320e0c2e` and prior Pre-Critic gate are invalidated by Independent Controller Critic comment `5482011446` (P2 REWORK).

## New immutable substantive Artifact A

`c78cc2d1480f0baeb6525f5bfdb51d1bd7ea6229`

The substantive delta is intentionally narrow:
- `hasMultiRoomStatePatch()` now treats `selectedRoomRelation` as a multi-room state mutation;
- regression freezes the ambiguous relational `kind=message` path so Core must issue bounded selection clarification instead of acknowledging unresolved ambiguity.

## Rework verification

Critic REWORK workflow: `33419842184`

Results:
- TypeScript typecheck: PASS;
- tests: `165/165 PASS`;
- staging E2 reservation runner syntax: PASS;
- Wrangler Worker dry-run: PASS;
- regression `critic P2 ambiguous relational message cannot be acknowledged as accepted`: PASS;
- temporary rework workflow/script removed before Artifact A commit.

## Previous critical fixes retained

- P1 stale/prior valid room cannot execute after invalid correction;
- invalid occupancy cannot be silently accepted;
- `las dos` and `la otra` resolve only under bounded unambiguous conditions;
- unknown room references never become authoritative candidate IDs;
- unresolved room/occupancy state blocks tool execution;
- multi-room reservation execution remains disabled in R2.4;
- single-room Policy/HITL/idempotency/ownership and tenant isolation regressions remain green.

## Severity gate

Open P0: `0`
Open P1: `0`
Open P2: `0`

QA verdict: `PASS`.

A fresh PR `core-ci` over an orchestration-only Boundary B head is still required before a new Pre-Critic and fresh Independent Critic verdict.
