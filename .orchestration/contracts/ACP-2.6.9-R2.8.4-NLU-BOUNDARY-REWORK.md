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
