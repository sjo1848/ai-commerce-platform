# ACP 2.6.9-R2.7 — Adversarial QA

Status: `PASS / RECLOSED`

Substantive artifact head: `363c1937d17e71a09e513707185a127332a792ec`

Contract: `.orchestration/contracts/ACP-2.6.9-R2.7-ADVERSARIAL-QA.md`

## Fresh attack record

R2.7 did not start from a green assumption. It froze cross-stage regressions first and reproduced failures before fixing them.

### Initial RED — CI #457 / `33467426308`

The fresh corpus demonstrated that:
- provider failure after a grounded multi-room selection fell back to stale R2.4 behavior instead of preserving R2.5 composite orchestration;
- natural `¿Tenés habitaciones para dos?` did not reliably become user-owned `guests=2` semantic memory.

### Rework

Closed defects:
1. **P2 — provider-failure multi-room regression**: deterministic fallback now routes the visible `hms.createMultiReservation` capability from server-grounded selected rooms/dates and never collapses multi-room intent into the single-room tool.
2. **P2 — colloquial reservation imperative**: fallback recognizes natural `reservame/reserváme/reservanos` forms required to reach the composite reservation path when the provider is unavailable.
3. **P2 — natural party-size grounding**: `habitaciones/cuarto(s)/rooms para N` persists the unambiguous party size with user provenance and availability intent.

### Intermediate GREEN — CI #460 / `33467815488`

The first cross-stage rework passed the full suite: `215/215 PASS` plus typecheck, staging-E2 syntax and Wrangler dry-run.

### Fresh QA RED — CI #461 / `33467984755`

QA then falsified the new party-size rule with `¿Tenés habitaciones para dos noches?`: the phrase could be misread as `guests=2` even though `dos` modifies the stay duration.

This was classified **P2 semantic grounding** and blocked closure.

### Final rework

The party-size pattern now excludes immediate duration/unit nouns (`noches`, `días`, `camas`, room nouns) while the independent room-query wording still establishes `availability` intent. Thus:
- `habitaciones para dos` → `guests=2`, availability;
- `habitaciones para 2` → `guests=2`, availability;
- `habitaciones para dos noches` → no invented guest count, still availability.

### Final GREEN — CI #463 / `33468363790`

Substantive artifact `363c1937d17e71a09e513707185a127332a792ec`:
- `216/216 PASS`;
- typecheck PASS;
- staging E2 runner syntax PASS;
- Wrangler dry-run PASS.

## Re-attacked inherited safety surface

The same final suite re-ran and passed the accumulated R2 protections, including:
- prompt/tool injection and non-visible tool rejection;
- trusted tenant/hotel/actor/guest authority and tenant isolation;
- unknown/trusted model fields and model-state mutation rejection;
- durable semantic memory scope, poisoning, tombstones, concurrency and stale replay;
- authoritative room/ordinal grounding and occupancy ambiguity;
- exact HITL plan/fingerprint binding and stale approval rejection;
- group create/cancel ownership, idempotency and session scoping;
- child revalidation, partial failure, compensation and `OUTCOME_UNKNOWN` semantics;
- cancellation one-vs-all, negation/exclusion and stale booking references;
- response grounding and unsupported operational/payment claims.

## Authority review

The new deterministic fallback does not acquire execution authority. `ChatOrchestrator` still recomputes multi-room clarification state and canonicalizes composite room IDs/dates from durable server state before execution; trusted guest identity, approval, policy, idempotency, ownership and HMS remain server-owned.

## Deferred staging-quality probe

`llm-model.ts` still contains historical R2.4 wording about multi-room execution being blocked until R2.5. It is not an authorization bypass because Core canonicalization remains authoritative, but it is a real-model quality risk. It is explicitly carried into R2.8 staging E2E and must not be treated as evidence that normal-model multi-room behavior passes until R2.8 verifies it.

## Verdict

`QA PASS / RECLOSED`

Open findings: `P0/P1/P2 = 0/0/0`.

R2.7 is not closed yet: Pre-Critic, fresh Independent Critic, exact-head evidence, merge and post-merge regression remain required.
