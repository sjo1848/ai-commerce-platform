# ACP-2.6.9-R2.8.4 — NLU Boundary Rework Contract

Status: `ACTIVE / ARCHITECTURAL_REWORK`

## Boundary

Only the LLM may derive, from open natural language, intent or semantic references that can influence a mutating operation. Mechanical deterministic processing remains permitted for read-only work and for validating/grounding already-structured state. The production fallback must never produce or pass through a `ToolPlan` with `risk:write`; it must discard any associated `statePatch` and return a safe clarification or non-operational response.

## Core obligations

- Core validates and grounds structured LLM output against authoritative state, all-or-nothing for room selection and occupancy.
- An incomplete, ambiguous, stale, or partially groundable selection fails closed; it must not become a write plan.
- A valid current selection replaces the previous selection rather than merging stale room state.
- Natural-language room references are covered by the real-model LLM corpus, not by a deterministic NLU parser.
- R2.8.4 requires exact C06-to-C07 authoritative room correlation, exact deployed Version ID verification, and no mutation before the later HITL/create block.

## Gate

This rework is not a technical closure. R2.8.5 remains blocked until the boundary is implemented, reviewed, and verified on the exact deployed artifact.
