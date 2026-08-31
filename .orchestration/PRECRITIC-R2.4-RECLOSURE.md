# ACP 2.6.9-R2.4 — Pre-Critic Reclosure

Status: `PASS — READY FOR FRESH INDEPENDENT CRITIC`
Date: `2026-08-31`
PR: `#46`

## Supersedes

The prior Pre-Critic tied to `35af379a5f6286c223fe0fe1f80b63f5320e0c2e` is invalidated by Independent Controller Critic REWORK comment `5482011446`.

## Immutable substantive Artifact A

`c78cc2d1480f0baeb6525f5bfdb51d1bd7ea6229`

Any source/test behavior change after this point invalidates this gate and requires new implementation, QA and Pre-Critic evidence.

## Boundary B

QA reclosure:
`.orchestration/reviews/ACP-2.6.9-R2.4-QA-RECLOSURE.md`

Boundary commit:
`896b8653abdacfea77e11deebdbe73d7441b7a42`

## Evidence

- critic-rework workflow `33419842184`: `165/165 PASS`;
- TypeScript typecheck: PASS;
- staging E2 syntax: PASS;
- Wrangler dry-run: PASS;
- fresh integration `core-ci` `33419937307`: PASS;
- open P0/P1/P2 after reclosure QA: `0/0/0`.

## Fresh critic checklist

The Independent Critic must review the complete R2.4 Artifact A, not merely the last P2 delta, and verify:

1. HMS candidate set remains the sole source of authoritative room IDs.
2. Exact numbers, IDs, ordinals, `las dos` and `la otra` cannot escape bounded server resolution.
3. Ambiguous relational `kind=message` routes cannot be acknowledged as accepted.
4. Invalid room/occupancy corrections cannot execute any tool using stale/prior grounding.
5. Clarification markers persist/merge correctly and are cleared with stale availability grounding.
6. Room-selection revision prevents stale/concurrent rollback.
7. Stay changes invalidate obsolete availability and selected rooms.
8. Multi-room createReservation remains blocked; no R2.5 execution semantics leaked into R2.4.
9. Single-room quote/reservation, Policy, HITL, approval binding, idempotency, ownership and tenant isolation remain green.
10. Trusted scope/provenance/revision remains outside LLM authority.
11. Artifact/evidence boundary is internally consistent.

Verdict requires open P0/P1/P2 = `0/0/0`.
