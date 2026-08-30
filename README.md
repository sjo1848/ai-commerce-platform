# AI Commerce Platform

Multi-tenant Agent Core for commerce and local services. The platform connects natural-language agent experiences to real operational systems through governed tools, tenant policies, auditability, approvals, idempotency and reusable domain adapters.

## Current state

- Phase 1 — isolated Agent Core: complete.
- Phase 2.2 — HMS Product Acceptance: complete.
- Phase 2.3 — real HMS Service Binding: complete.
- Phase 2.4 — real read-only availability + quote E1: complete.
- Phase 2.5 — controlled reservation/cancellation with HITL and real staging E2: **PRODUCT_ACCEPTED**.
- **Current: Phase 2.6 — LLM Model Router / HMS Agentic Experience.**

Fase 3 — Alquileres is intentionally blocked until 2.6 proves that the same Core can deliver a natural, contextual AI experience in HMS without weakening the deterministic safety boundaries.

## Architecture

`Channel → ChatOrchestrator → ModelRouter → AgentCoreExecutor → ToolRegistry → PolicyEngine → Adapter → Operational system`

The architecture intentionally separates intelligence from authority:

- the model interprets language/context, proposes tool plans, requests clarification and composes responses;
- Agent Core validates plans, resolves trusted context, applies policy/HITL/idempotency/audit and controls execution;
- adapters isolate domain integrations;
- operational systems remain the source of truth.

The LLM/model layer never receives direct database bindings and cannot elevate permissions, choose trusted tenant/hotel/actor context, set approval metadata or arbitrary operation tokens.

## HMS proof completed in 2.5

The live staging flow currently proves:

- real HMS availability and quote through Service Binding;
- controlled createReservation and cancelReservation;
- exact-operation Human-in-the-Loop approval;
- durable approval challenges and booking ownership;
- authoritative downstream replay/conflict semantics;
- inventory removal/restoration;
- audit and idempotency controls;
- synthetic cross-repository staging E2E with cleanup.

## Why 2.6 exists

The accepted 2.5 staging experience still uses `DeterministicModelRouter` as its primary language interpreter. It proves governed execution, but it still behaves like a command parser.

2.6 replaces the primary user-facing interpretation path with a provider-independent `LLMModelRouter` while preserving `DeterministicModelRouter` as a safe deterministic fallback/test fixture.

Target experience examples include natural requests such as:

- “Somos dos y queremos ir el próximo fin de semana, ¿qué tenés?”
- “¿Cuánto sale la segunda opción?”
- “Buenísimo, reservámela.”
- “Me equivoqué, cancelá esa reserva.”

The model may resolve language and context, but all operational facts/actions must still flow through registered tools and deterministic controls.

## 2.6 gate

See `.orchestration/contracts/ACP-2.6-LLM-MODEL-ROUTER.md`.

2.6 closes only after:

1. frozen conversational/adversarial acceptance corpus;
2. provider-independent model adapter + LLM router;
3. strict structured tool planning and server-side revalidation;
4. safe multi-turn operational context;
5. clarification + natural grounded responses;
6. usage/latency/cost telemetry and safe fallback;
7. adversarial QA + Independent Critic PASS;
8. real-model conversational HMS staging E2E PASS;
9. Human Product Acceptance: ACCEPT.

## Commands

```bash
npm run typecheck
npm test
npm run qa
```

## Safety boundary

Production, real customer data, payments, paid-resource expansion, broader autonomous side effects and second-vertical implementation require their own authorized gates. WhatsApp is not a dependency for proving 2.6.
