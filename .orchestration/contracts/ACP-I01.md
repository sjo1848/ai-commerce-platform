# Task Contract ACP-I01 — Phase 1 Agent Core

## Objective
Close roadmap sub-stages 1.4–1.8 with an isolated, testable Agent Core that does not modify HMS or Alquileres.

## Requirements → Acceptance → Evidence

1. **Independent bootstrap** → TypeScript project builds without domain repo coupling → `npm run typecheck`, `npm run build`.
2. **Tenant/actor/session/tool registry** → tenant-scoped session and tool discovery, fail on cross-tenant session reuse → unit/adversarial tests.
3. **Policy/audit/usage** → fail-closed tool authorization, approval decision, per-call audit and usage → tests + in-memory evidence.
4. **Idempotency** → side-effect calls require key; exact replay does not duplicate; mismatch conflicts → tests.
5. **Fake HMS vertical slice** → webchat can query read-only availability via Core and fake adapter → integration test.
6. **Adversarial QA** → injection, tenant switch, forbidden tools, adapter errors, idempotency, limits → adversarial test suite.
7. **Scope** → no HMS/Alquileres writes, no paid resources, no deployment → repository artifact inspection.

## Non-goals
- real LLM provider;
- Durable Objects/Agents SDK persistence;
- real HMS service binding;
- WhatsApp;
- production deploy.

## Gate
Phase 1 is technically complete only if typecheck + all tests pass and Pre-Critic evidence has no FAIL/UNPROVEN applicable invariant. Publication/review requires an immutable artifact.
