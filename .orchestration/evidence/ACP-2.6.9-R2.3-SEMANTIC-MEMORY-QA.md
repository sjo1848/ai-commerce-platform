# ACP 2.6.9-R2.3 — Durable Semantic Memory v2 — QA

Status: `PASS`
Artifact A: `3f3dbd60b781df08a0737018b17aa6832b443362`
CI: `33354772625`

## Scope reviewed
- server-side current-turn extraction for dates and total guest count;
- deterministic correction and explicit-clear semantics;
- user/tool/server/legacy provenance;
- durable tombstones for explicit clears;
- tenant/actor/session scope binding;
- bounded preference memory and prompt-poison filtering;
- active conversational intent;
- model-safe state projection;
- legacy snapshot migration;
- concurrent snapshot merge;
- stale tool-result protection;
- preservation of existing Tool Registry, Policy, HITL, idempotency and HMS authority.

## Rework history closed
The final Artifact A includes fixes for all substantive P1/P2 findings raised during PR #44 review:
1. same-turn guest correction chooses the latest affirmed count;
2. same-turn date correction chooses the latest affirmed range;
3. party categories are summed (`2 adultos + 2 niños = 4`);
4. accented Spanish lodging preferences are recognized;
5. instruction-like preference text is rejected from durable memory;
6. negated clear language (`No olvides...`) does not clear facts;
7. current-turn semantic facts are persisted before provider routing;
8. explicit clears leave user-owned tombstones so stale tools cannot resurrect them;
9. overlapping same-session snapshots are merged by per-field revision rather than last-writer-wins;
10. concurrent merge advances the global semantic revision;
11. legacy pre-R2.3 snapshots are normalized/migrated before merge;
12. a stale tool result cannot re-ground rooms from an obsolete stay context.

## Exact-head regression
Run `33354772625` on Artifact A completed successfully:
- TypeScript typecheck: PASS
- tests: `117/117 PASS`
- staging E2 runner syntax: PASS
- Wrangler Worker dry-run: PASS

## Adversarial checks
- model-authored dates/guest statePatch cannot become durable semantic memory: PASS
- known user memory overrides conflicting model tool args: PASS
- cross-scope memory reuse fails closed: PASS
- trusted fields remain outside semantic memory/model authority: PASS
- prompt/instruction text cannot persist as a lodging preference: PASS
- stale tool result cannot undo a correction or explicit clear: PASS
- concurrent requests retain non-conflicting facts from both turns: PASS
- reservation/HITL/idempotency regressions remain green: PASS

## Severity
Open findings against Artifact A:
- P0: 0
- P1: 0
- P2: 0

Verdict: `QA_PASS`
