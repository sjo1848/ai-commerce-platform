# AI Commerce Platform — Agent Core State

Phase: `ACP INTEGRATION — PHASE 2.6`
Task: `ACP-2.6-LLM-MODEL-ROUTER`
Status: `PLANNING_AUTHORIZED`
Current sub-stage: `2.6.1 — CONVERSATIONAL ACCEPTANCE CORPUS`

## Last closed gate
`ACP-2.5-CONTROLLED-RESERVATION` — `PRODUCT_ACCEPTED / CLOSED`.
Human verdict: `ACCEPT`.
Closure evidence: `.orchestration/evidence/ACP-2.5-CLOSURE.md`.

Accepted 2.5 evidence remains anchored to:
- ACP product artifact `3d1a08376b9581dfc1fc159a6bf3b0733996fa61`;
- ACP final staging candidate `98ede44ed97764c9835d818290167903686f3b4e` — Independent Critic PASS;
- HMS artifact `70fae5c902af557eadc2802ba773f44b9f95fd46` — Independent Critic PASS;
- HMS staging deploy `33301324856` — PASS;
- ACP staging deploy `33301384087` — E1 + E2 PASS;
- Human Product Acceptance — ACCEPT.

## Product decision after acceptance
Do not move to Fase 3 — Alquileres yet.

The current HMS staging flow proves governed tool execution and reversible side effects but still uses `DeterministicModelRouter` as the primary language interpreter. The next increment must make HMS feel like the product thesis: a natural, contextual AI agent that can plan tool use without gaining authority over trusted operational controls.

Drive decision: `DEC-002 — Consolidar experiencia IA en HMS antes de segunda vertical`.
Execution contract: `.orchestration/contracts/ACP-2.6-LLM-MODEL-ROUTER.md`.

## 2.6 execution sequence
1. `2.6.1` Freeze a conversational + adversarial acceptance corpus before implementation.
2. `2.6.2` Introduce provider-independent Model Provider Adapter + `LLMModelRouter`; keep deterministic router as fallback/test fixture.
3. `2.6.3` Enforce strict structured tool planning and server-side revalidation.
4. `2.6.4` Add safe operational conversation context for multi-turn references without making LLM memory authoritative.
5. `2.6.5` Add minimal clarification behavior and natural response composition grounded in tool results.
6. `2.6.6` Instrument model usage, latency, cost and safe timeout/fallback behavior.
7. `2.6.7` Run adversarial QA and Independent Critic on the frozen artifact.
8. `2.6.8` Run real-model conversational E2E against HMS staging through reserve/cancel + cleanup.
9. `2.6.9` Return to Human Product Acceptance.

## Non-negotiable architecture
The LLM may interpret, plan, clarify and compose. It may not choose trusted tenant/hotel/actor context, permissions, approval metadata, operation tokens or arbitrary tools. Tool Registry, validation, Policy Engine, HITL, idempotency, audit, ownership and HMS transactional truth remain deterministic and authoritative.

## Gate to Fase 3
Fase 3 — Alquileres remains blocked until ACP 2.6 closes with `Human Product Acceptance: ACCEPT`. The second vertical must then reuse the same Agent Core + LLM Model Router; only domain adapter/tool/truth semantics should materially change.

## Boundaries still in force
No production cutover, real customer data, payments, paid-resource expansion, WhatsApp requirement, broader autonomous writes or second-vertical implementation is authorized by 2.6 planning.
