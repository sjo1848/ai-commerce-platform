# AI Commerce Platform — Agent Core v0.1

Phase 1 isolated Agent Core for the AI Commerce Platform.

## Scope

This repository artifact intentionally contains **no HMS or Alquileres domain persistence**. It provides:

- tenant resolution and isolation;
- actor + session context;
- tenant-scoped tool discovery;
- fail-closed policy evaluation;
- approval decisions;
- audit and usage sinks;
- idempotent side-effect execution;
- a deterministic model/router seam;
- a read-only `FakeHmsAdapter`;
- a minimal webchat HTTP vertical slice;
- adversarial tests for tenant switching, forbidden tools, prompt injection, errors, idempotency and limits.

## Commands

```bash
npm run typecheck
npm test
npm run qa
```

No network install is required in the current validation environment; the source uses Web Platform APIs and TypeScript only.

## Architecture

`Webchat → ChatOrchestrator → ModelRouter → AgentCoreExecutor → ToolRegistry → PolicyEngine → Adapter`

The LLM/model layer never receives database bindings and cannot call arbitrary tools by name from user text.
