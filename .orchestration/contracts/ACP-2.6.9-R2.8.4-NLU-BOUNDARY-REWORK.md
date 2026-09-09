# ACP-2.6.9-R2.8.4 — NLU Boundary Rework Contract

Status: `ACTIVE / ARCHITECTURAL_REWORK`

## Boundary

Only the LLM may derive, from open natural language, intent or semantic references that can influence a mutating operation. Mechanical deterministic processing remains permitted for read-only work and for validating/grounding already-structured state. The production fallback must never produce or pass through a `ToolPlan` with `risk:write`; it must discard any associated `statePatch` and return a safe clarification or non-operational response.

## Core obligations

### Mutation grounding (rework amendment)

- A write proposal carries a closed `mutationGrounding` union: `reservation` requires explicit check-in, check-out and exact room IDs; `cancellation` requires either `{scope: "single", bookingId}` or `{scope: "all"}`.
- A write is invalid without complete structured grounding. Core MUST NOT recover missing mutation fields from current-turn raw text, `applyUserSemanticTurn`, generic `statePatch`, or `enrichPlanInputFromState`.
- Cancellation scope and reference are LLM-derived structured data and are validated by Core against server-owned active bookings. Raw text cannot override, broaden, or repair them.
- Clarifications expose machine-readable `outcome: "clarification"` and a non-empty `missing` field list; an HTTP success status alone is not evidence of clarification.

- Core validates and grounds structured LLM output against authoritative state, all-or-nothing for room selection and occupancy.
- An incomplete, ambiguous, stale, or partially groundable selection fails closed; it must not become a write plan.
- A valid current selection replaces the previous selection rather than merging stale room state.
- Natural-language room references are covered by the real-model LLM corpus, not by a deterministic NLU parser.
- R2.8.4 requires exact C06-to-C07 authoritative room correlation, exact deployed Version ID verification, and no mutation before the later HITL/create block.

## Gate

This rework is not a technical closure. R2.8.5 remains blocked until the boundary is implemented, reviewed, and verified on the exact deployed artifact.

## Pre-RUN-1 acceptance execution amendment (2026-09-08)

This records the Product Owner's authorized technical REWORK and explicit provider gate.
It does not authorize deployment, provider inference, approval consumption, merge or closure.

- R2.8.4 validation is manual-only. Ordinary push must run offline CI only.
- RUN 1 requires explicit human authorization of the current exact PR SHA, a fresh experiment and fresh request/session identities, baseline `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, affinity OFF, and configured budget `7000/7000/0/180` (run cap / configured available / reserve / next-call allowance). Configuration is not proof of live account quota.
- The only observability-related pre-provider readiness gate is a synchronous, exact-runtime admission observation (an intentionally unauthenticated POST returning exact HTTP 403 may be used). It proves admission/version readiness only; it does not prove model routing, fallback, durable consumption, HMS activity, or approval state.
- Stop on first contractual failure and retain the partial report; do not send subsequent validation requests to accumulate failures. Missing telemetry is UNKNOWN and fails evidence admission.
- Exact C06: “Hola. Somos cuatro y queremos quedarnos del 1 al 3 de enero de 2030. ¿Qué tenés disponible?” HMS transactional availability must ground 101 and 102, 2030-01-01 through 2030-01-03, four guests.
- Exact C07: “Quiero reservar la 101 y la 102.” The only conditional follow-up is “Dos en cada habitación.” when occupancy clarification is naturally required. No rescue/retry turn may satisfy C07.
- Direct functional/HMS/HITL evidence is authoritative for availability, exact plan/context, composite `APPROVAL_REQUIRED`, unconsumed approval, and zero pre-approval mutation. Final evidence must bind authoritative dates, guests, exact rooms and applicable 2+2 occupancy to `hms.createMultiReservation`; server plan and canonical context are evidence, not model-authored facts or approval authority. Runner reports and artifacts record approval presence only, never approval-token values.
- L01–L15 retain their linguistic requests and expected semantics. Corrections/negations and unknown/ambiguous references must additionally exercise prior-selection replacement/invalidation. Corpus route fallback cannot substitute for real LLM interpretation.
- Correlate requestId, sessionId, experimentId, trace, exact Worker Version and candidate SHA where captured. Missing route telemetry, historical query results, or live-tail transport is `UNKNOWN_NOT_CAPTURED`/supplemental and is never inferred as zero. Captured invalid/negative evidence (including fallback or wrong-version evidence) remains fail-closed. Stored positive durable-budget reconciliation remains material before RUN 1 is declared reconciled GREEN; a request-ID-only query is insufficient.
- RUN 2 requires a separate explicit gate after complete GREEN and reconciliation of RUN 1 on the same SHA/config. Two same-SHA consecutive GREENs still require exact-head CI, fresh Critic, Integration Review, SHA-pinned merge, main CI and durable convergence before closure.
- Consumption Hardening remains historically `DURABLE_BUDGET_E2E_PASS_ISOLATED` / `CONSUMPTION_HARDENING_SUFFICIENT`. Proven current budget safety defects may receive bounded offline corrections; no CH-1.4 or optimization track is opened.
