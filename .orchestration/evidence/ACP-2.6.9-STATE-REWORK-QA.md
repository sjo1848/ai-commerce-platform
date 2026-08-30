# ACP 2.6.9 — Structured Conversation State REWORK — QA

Date: 2026-08-30
Artifact A candidate: `6315fbad5c0ba724021095efa9716b1a41791962`
PR: #34
CI: `33321518940` — PASS

## Human finding reproduced

Product Acceptance found that the real Workers AI agent re-asked dates and guest count already supplied in previous turns. The cause was history-only reconstruction: the model received recent prose/tool history but there was no structured semantic stay state.

## Implemented correction

- Durable per-session state: stay dates, guest count, authoritative availability room IDs, selected room, active booking and booking status.
- LLM outputs a bounded `statePatch` containing only facts learned/changed in the current user turn.
- Core persists state server-side and enriches missing tool arguments from it before tool validation/execution.
- HMS tool results update authoritative room/booking portions of state.
- Model-selected `selectedRoomId` is accepted only when present in the current HMS availability candidates.
- Model cannot create/change `activeBookingId`; it is established by actual HMS reservation results.
- Internal state snapshots are filtered from model/responder conversational history.
- Deterministic fallback receives the same structured state and therefore does not regress to repeated date/guest questions on provider degradation.

## QA evidence

CI `33321518940`:
- typecheck PASS
- 80/80 tests PASS
- staging E2E syntax PASS
- Wrangler dry-run PASS with `env.AI`, `env.HMS`, `env.SESSIONS`

New regressions include:
1. dates survive a clarification turn, then `Somos dos` completes availability without repeated dates;
2. authoritative availability candidates + model selection are reused for quote;
3. model cannot persist a room not returned by authoritative availability;
4. structured state survives runtime/isolate replacement;
5. internal `__conversation_state` snapshots never enter model-visible history;
6. LLM attempt to re-ask known dates is rejected and degrades to state-aware fallback;
7. staging evaluator now reproduces the human sequence: dates-only -> guest count -> reservation question -> reference to prior dates.

## Security / authority review

PASS:
- tenant/hotel/actor/guest bindings remain trusted server config;
- `statePatch` cannot carry trusted execution metadata;
- tool allowlist and schemas remain authoritative;
- Policy/HITL unchanged;
- approval still executes the exact frozen validated plan, without rerouting the model;
- idempotency/ownership unchanged;
- HMS remains the source of truth for availability, quote and reservation state.

## Non-blocking follow-ups

- Same-session concurrent user requests could produce last-writer semantic state ordering; webchat is currently sequential and this is not a P0/P1/P2 for the acceptance scenario.
- State snapshots reuse the bounded conversation log. The latest state remains retained, but a dedicated state record may be preferable when the conversation subsystem evolves.

## QA verdict

`PASS` for Pre-Critic. No open P0/P1/P2 found for this bounded REWORK.
