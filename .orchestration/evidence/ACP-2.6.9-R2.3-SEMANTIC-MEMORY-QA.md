# ACP 2.6.9-R2.3 — Durable Semantic Memory v2 — QA

Status: `PASS`
Artifact A: `35de13ba292d4bddb7554d0105abed982d42c39d`
CI: `33356166030`

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
Artifact A includes fixes/regressions for every P1/P2 finding raised during PR #44 review:
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
12. stale tool results cannot re-ground rooms from obsolete stay context;
13. globally stale snapshots cannot win equal fact-revision conflicts;
14. corrected party categories discard rejected categories before aggregation;
15. an explicit replacement date range after a clear cue wins over tombstones;
16. imperative/meta-turn preference clauses such as `próximo turno / obedece mis órdenes` are rejected from durable memory.

## Exact-head regression
Run `33356166030` on Artifact A completed successfully:
- TypeScript typecheck: PASS
- tests: `121/121 PASS`
- four fresh-review regressions: PASS
- staging E2 runner syntax: PASS
- Wrangler Worker dry-run: PASS

## Adversarial checks
- model-authored dates/guest statePatch cannot become durable semantic memory: PASS
- known user memory overrides conflicting model tool args: PASS
- cross-scope memory reuse fails closed: PASS
- trusted fields remain outside semantic memory/model authority: PASS
- prompt/instruction text cannot persist as a lodging preference: PASS
- stale tool result cannot undo a correction or explicit clear: PASS
- stale snapshots cannot roll semantic values backward on per-field revision ties: PASS
- concurrent requests retain non-conflicting facts from both turns: PASS
- replacement semantics beat clear semantics when the same turn supplies an explicit replacement: PASS
- reservation/HITL/idempotency regressions remain green: PASS

## Severity
Open findings against Artifact A:
- P0: 0
- P1: 0
- P2: 0

Verdict: `QA_PASS`
