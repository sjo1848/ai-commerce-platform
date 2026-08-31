# ACP 2.6.9-R2.2 — Implementation Snapshot

Branch: `feat/acp-2.6.9-r2.2-natural-dialogue`
Snapshot head before PR/CI: `077dc96326e6ca17d893f549e792cca61d2d718e`

Implemented source changes:
- `src/core/types.ts` — message purpose and clarification-field contract;
- `src/core/deterministic-model.ts` — cordial greeting/social/help fallback and classified clarifications;
- `src/core/llm-model.ts` — greeting/social/help structured routing, operational-intent precedence and social-state mutation rejection;
- `src/core/model-responder.ts` — server-built GroundedFactEnvelope, placeholder-only operational generation, server-side draft validation/hydration and bounded conversational rewriting;
- `src/core/orchestrator.ts` — routes both model messages and server-side required-field clarifications through the dialogue responder.

Tests:
- `test/model-responder.test.mjs` expanded for grounding and conversational composition;
- `test/llm-routing-contract.test.mjs` expanded for greeting/social router semantics;
- `test/r2-natural-dialogue.test.mjs` verifies orchestrator integration.

No R2.3/R2.4/R2.5 state or multi-room changes are included.
