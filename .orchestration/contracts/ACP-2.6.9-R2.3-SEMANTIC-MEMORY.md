# ACP 2.6.9-R2.3 — Durable Semantic Memory v2

Status: `AUTHORIZED / IMPLEMENTATION`
Parent: `ACP 2.6.9 R2 — Natural Receptionist Experience`
Depends on: `R2.2 — Natural Receptionist Dialogue Layer — TECHNICAL_PASS / CLOSED`

## Goal
A guest must not be asked again for an unambiguously known stay fact unless the guest explicitly changes or clears it. Durable memory must not depend on replaying prose history or trusting an LLM-authored memory patch.

## Scope
R2.3 covers only single-stay semantic memory:
- check-in date;
- check-out date;
- total guest count;
- bounded non-operational lodging preferences;
- active conversational intent;
- explicit correction and clear semantics;
- provenance/revision metadata;
- tenant/actor/session scope binding;
- structured compaction through the existing conversation-backed state snapshot.

R2.3 explicitly excludes:
- `selectedRooms[]`, room groups or occupancy allocation (`R2.4`);
- multi-room reservation execution (`R2.5`);
- model comparison (`R2.6`);
- production cutover or a second vertical.

## Authority model
### User semantic facts
Dates, guest count and preferences are persisted from the **current user turn**, not from prose history and not from an LLM memory assertion.

Core performs bounded server-side extraction for high-value stay facts. A model may still propose routing/tool arguments, but it cannot make an ungrounded date/guest value durable merely by placing it in `statePatch`.

### Operational facts
HMS remains the source of truth for rooms, availability, prices, bookings and inventory. Tool execution may fill a missing stay fact in memory when the server did not already have a user-origin fact, but it must not silently downgrade existing user provenance.

### Trusted authority
Roles, permissions, tenant/hotel/actor identity, approval state, operation tokens and idempotency are never semantic memory and can never be created by the model or user text.

## Memory shape
The existing single-room `ConversationState` remains compatible, but gains bounded `semanticMemory` metadata:
- monotonically increasing `revision`;
- server-owned scope `{tenantId, actorId, sessionId}`;
- provenance for `checkIn`, `checkOut`, `guests`;
- bounded sanitized user preferences;
- active conversational intent.

Each semantic mutation records a source (`user`, `tool`, `server`, or migration-only `legacy`) and the revision that introduced it.

## Current-turn grounding
Core must recognize at minimum the R2 corpus patterns:
- `Somos dos` / `Somos cinco`;
- `... para dos` when attached to a stay/date request rather than a room allocation;
- `del 15 al 17 de enero de 2027`;
- correction with inherited month/year, e.g. `Me equivoqué, del 16 al 18`;
- explicit ISO date ranges;
- explicit clear language for dates/guest count/preferences.

If a model proposes a durable stay fact not grounded in the current user turn, Core ignores that semantic patch. Existing server memory wins over conflicting model tool arguments for dates/guest count.

## Correction semantics
An explicit new current-turn value replaces the previous value deterministically:
- `Somos dos` → guests=2;
- `No, pará, somos tres` → guests=3;
- existing dates + `Me equivoqué, del 16 al 18` → replace dates while retaining guests.

A clear is accepted only from explicit field-specific clear language. Ambiguous silence never clears memory.

## Preferences
Preferences are user-owned context, not hotel facts. They are:
- extracted only from explicit preference language;
- bounded in length/count;
- sanitized against instruction/prompt/trusted-authority content;
- never allowed to claim that a room actually has the requested property;
- non-operational in R2.3.

## Active intent
Active intent is bounded to hotel conversation (`availability`, `quote`, `reservation`, `cancellation`). It is server-derived from the current turn and/or the validated routed capability. It provides conversational continuity only; it cannot authorize or execute a side effect.

## Isolation and compaction
Semantic memory is scope-bound to tenant + actor + session. A scope mismatch fails closed.

The durable state remains a structured internal snapshot (`__conversation_state`) stored independently of visible prose. Runtime replacement must recover from the latest structured snapshot without reconstructing facts from assistant/user history.

## Required R2.3 tests
1. dates + guests survive social/noise turns and runtime replacement;
2. guest correction replaces prior value;
3. date correction inherits known month/year and preserves guests;
4. explicit clear removes only the requested fact;
5. model-only stale/poisoned `statePatch` cannot overwrite semantic memory;
6. known memory overrides conflicting model tool arguments;
7. preferences persist as sanitized user context and do not become operational facts;
8. memory scope mismatch fails closed;
9. structured state snapshots remain hidden from model-visible history;
10. all existing HITL/idempotency/grounding regressions remain green.

## Exit criteria
- full typecheck/regression suite PASS;
- R2.3 tests PASS;
- known-fact retention = 100% for R2.3 scenarios;
- correction handling = 100%;
- cross-scope contamination = 0;
- memory poisoning accepted = 0;
- Wrangler dry-run PASS;
- QA PASS;
- zero open P0/P1/P2;
- Independent Critic PASS;
- merge + post-merge regression PASS.
