# ACP 2.6.9-R2.4 — Pre-Critic Gate

Status: `PASS — READY FOR INDEPENDENT CRITIC`
Date: `2026-08-31`
PR: `#46`
Substage: `2.6.9-R2.4 — Multi-Room Conversation Model`

## Immutable substantive Artifact A

`35af379a5f6286c223fe0fe1f80b63f5320e0c2e`

No source/test behavior may change after this boundary without invalidating this gate and returning to implementation + full QA.

## Orchestration Boundary B

QA boundary commit before this document:
`ed80023974e0f3b52d325844ab14055dbe02aa94`

QA review:
`.orchestration/reviews/ACP-2.6.9-R2.4-QA.md`

## Verified evidence

- final rework workflow `33419441828`: `164/164 PASS`;
- TypeScript typecheck: PASS;
- staging E2 reservation runner syntax: PASS;
- Wrangler Worker dry-run: PASS;
- fresh PR integration `core-ci` `33419557467`: PASS;
- open P0/P1/P2 after QA: `0/0/0`.

## Scope boundary

R2.4 implements conversation/state only:
- authoritative HMS candidate grounding (`id + roomNumber`);
- canonical `selectedRoomIds[]`;
- single-room compatibility alias only when exactly one room is selected;
- room count intent;
- explicit room occupancy;
- exact numbers, ordinals and bounded relational references (`las dos`, `la otra`);
- correction and stale/concurrent selection protection;
- fail-closed clarification for unknown/ambiguous room/occupancy references.

Explicitly excluded:
- multi-room reservation execution;
- multi-operation approval/compensation;
- multi-booking cancellation;
- production cutover;
- second vertical.

Those remain R2.5+.

## Mandatory Independent Critic checks

The critic must independently verify:

1. **Candidate authority** — no model-proposed room ID/number/index can become canonical unless it resolves to the current HMS candidate set.
2. **Relational references** — `las dos` resolves only for exactly two candidates; `la otra` only when a single other candidate is unambiguous; larger sets require clarification.
3. **Invalid correction safety** — invalid room/occupancy changes preserve useful prior context only as unresolved state and cannot execute any tool using stale/prior grounding.
4. **Tool-block invariant** — any `multiRoomConversationIssue` blocks tool enrichment/execution before the executor.
5. **Persistence/concurrency** — clarification markers and room-selection revision survive storage/merge and stale replay cannot roll back newer selection.
6. **Availability refresh** — stale stay/availability changes clear obsolete candidate/selection grounding.
7. **Single-room regression** — existing quote/reservation behavior, Policy, HITL, approval fingerprinting, idempotency and ownership remain intact.
8. **Provider boundary** — trusted tenant/actor/session/provenance/revision data is not delegated to the LLM.
9. **No scope creep** — multi-room `hms.createReservation` remains impossible in R2.4.
10. **Evidence integrity** — Artifact A is exactly the substantive SHA above; later commits are orchestration-only Boundary B.

## Gate rule

Allowed critic verdicts: `PASS`, `REWORK`, `BLOCKED`.

`PASS` requires open P0/P1/P2 = `0/0/0`.
Any P0/P1/P2 finding invalidates this Pre-Critic gate and returns automatically to REWORK. No Human Gate is created by ordinary technical findings.
