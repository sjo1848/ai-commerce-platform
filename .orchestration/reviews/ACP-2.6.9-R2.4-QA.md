# ACP 2.6.9-R2.4 — QA Review

Status: `QA PASS — AWAITING EXACT-HEAD CORE-CI / PRE-CRITIC`
Date: `2026-08-31`
PR: `#46`
Substage: `2.6.9-R2.4 — Multi-Room Conversation Model`

## Substantive Artifact A candidate

`35af379a5f6286c223fe0fe1f80b63f5320e0c2e`

This SHA is the substantive source/test boundary. Subsequent QA, Pre-Critic, evidence and state documents are orchestration-only Boundary B unless a new source/test change is required. Any substantive change invalidates this artifact candidate and requires a new exact SHA and full revalidation.

## Verification

Final rework workflow: `33419441828`

Results:
- TypeScript typecheck: PASS
- unit/integration regressions: `164/164 PASS`
- staging E2 reservation runner syntax: PASS
- Wrangler deploy dry-run: PASS
- temporary rework workflows/scripts removed before Artifact A commit

The first `core-ci` automatically associated with Artifact A (`33419479499`) ended `action_required` because Artifact A was authored/pushed by `github-actions[bot]`. It is explicitly NOT counted as an exact-head CI PASS. A Boundary-B commit must trigger a fresh core-ci over the unchanged substantive tree before Pre-Critic.

## QA findings and REWORK history

### P1 — invalid correction could reuse prior valid room

Finding: preserving the previously grounded room after an invalid correction (`la 999`, invalid ordinal, invalid occupancy reference) was conversationally useful, but the initial orchestrator could still enrich and execute a tool using the old room.

Fix:
- unresolved room selection/occupancy state now creates a server-owned clarification marker;
- `multiRoomConversationIssue` surfaces that marker;
- every tool route is blocked before enrichment/execution while the issue exists;
- regression `P1 invalid room correction cannot execute a tool using prior grounded room` passes.

Status: FIXED.

### P2 — invalid occupancy could be silently discarded

Finding: an invalid room-level occupancy reference could be discarded and produce an acknowledgement-like continuation.

Fix:
- invalid occupancy is preserved as unresolved server state;
- Core requests bounded occupancy clarification;
- no silent acceptance.

Status: FIXED.

### Product-contract gap — natural relational references

Finding: explicit numbers/ordinals were covered, but `las dos` and `la otra` were not first-class bounded references.

Fix:
- `las dos` resolves only when exactly two authoritative HMS candidates exist;
- `la otra` resolves only when exactly one selected room and one unambiguous alternative exist;
- otherwise Core requires clarification and never chooses arbitrarily.

Status: FIXED.

## Regression invariants verified

- 101 + 102 stays as two selected authoritative candidates.
- `las dos primeras` resolves server-side by candidate order.
- `las dos` is bounded to exactly two candidates.
- `la otra` only resolves when unambiguous.
- unknown IDs/numbers/out-of-range ordinals cannot become canonical grounding.
- invalid room/occupancy corrections cannot execute a tool using stale/prior grounding.
- occupancy totals that conflict with known guest total require clarification.
- selection correction 101+102 -> 101+103 preserves unaffected room and drops stale occupancy.
- concurrent equal-revision room selections cannot be rolled back by stale replay.
- single-room quote/reservation enrichment remains compatible.
- multi-room `hms.createReservation` remains blocked in R2.4.
- existing Policy/HITL/idempotency/ownership/tenant isolation regressions remain green.

## Severity gate

Open P0: `0`
Open P1: `0`
Open P2: `0`

QA verdict: `PASS`.

Next gate: fresh exact-head `core-ci` over an orchestration-only Boundary-B head, then Pre-Critic and Independent Critic. R2.5 remains blocked.
