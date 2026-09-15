# ACP-3.0 I3 — Deterministic Planner — Adversarial QA

Date: 2026-09-15
Branch: `feature/acp-3.0-i3-deterministic-planner`
Reviewed implementation head: `a8c2421ea6504f4c0d16f6462c635fdf2f6a17ab`
Base I2 PASS: `3474ca4a7007516ecc23ca9f50c96741736127d3`
Exact-head CI: `core-ci` #692 / run `34929243570` — PASS

## Verdict

`PASS`

Open implementation findings at reviewed head:
- P0: 0
- P1: 0
- blocking P2: 0

I3 remains isolated from runtime/Core integration.

## Review scope

Reviewed the full I2→I3 implementation delta against ACP-3.0.4 and the real HMS agent-facing contracts.

Checked:
- `HotelTaskDefinition` and `DomainCapabilities` bindings;
- exactly-one-`NextStep` Planner behavior;
- SHA-256 causal precondition fingerprints;
- missing-fact / read / grounding / mutation / pending / completion paths;
- capability mismatch fail-closed behavior;
- J01 progression;
- multi-room reserve;
- cancellation and modification limits;
- retry behavior;
- approval-pending lateral reads;
- historical/stale observations and failures;
- multi-intent transient directives;
- completion evidence correlation;
- Planner/Core/Policy/HITL boundary separation.

## Findings found and closed during the gate

### F1 — dependency projection typing

Initial candidate `2046db09793bc70017b27f75461f6307159dc7cf` failed CI because the Planner passed `Record<string, unknown>` to the canonical dependency fingerprint boundary.

Closed by typing Planner dependency projections with the bounded recursive `DependencyValue` contract.

### F2 — availability observation could be structurally valid but causally inconsistent

A persisted availability observation whose query no longer matched requested stay could otherwise be reused.

Closed by a Planner-side fail-closed consistency check in addition to normal Reducer invalidation.

### F3 — completion evidence was under-correlated

A historical successful execution plus an unrelated current booking observation could satisfy the earlier completion predicate.

Closed by requiring `ExecutionResult.observationId` to equal the current `BookingObservation.observationId` before reservation/cancellation completion.

### F4 — retry fallback treated failure history as one operation

`ToolObservations.failures` is a bounded history window. Multiple retained failures for the same capability are not proof of one uniquely retryable operation.

Closed by allowing targetless fallback only when exactly one failure record is eligible. `retryDirective.correlationId` may narrow the eligible failure by authority/failure identity. Ambiguity produces bounded ASK; write retry remains Core recovery.

### F5 — ephemeral business directive could be swallowed by presentation-only markers

A trigger containing a real read plus `interactionDirective` or `abortDirective` could previously return the acknowledgement/abort response and lose the read directive.

Closed by prioritizing current ephemeral business directives (`read`, `retry`, `show`) before presentation-only abort/interaction responses. Durable abort state is already reduced before Planner invocation.

### F6 — self-consistent contract identity spoofing

A caller could supply a modified `HotelTaskDefinition` and a matching modified capability view while retaining the canonical top-level identity strings.

Closed by checking the supplied v1 definition binding-by-binding against the canonical `HOTEL_TASK_DEFINITION_V1` contract before planning.

## Real capability matrix verified

Enabled semantic bindings correspond to existing HMS agent tools:
- availability → `hms.checkAvailability`
- quote → `hms.getQuote`
- reserve_single → `hms.createReservation`
- reserve_multi → `hms.createMultiReservation`
- cancel_single → `hms.cancelReservation`
- cancel_multi → `hms.cancelMultiReservation`

Not present and not invented:
- booking lookup/list
- booking modify
- generic compare/flexible-date search

Current TaskState v1 exposes a singular grounded booking target, so I3 does not synthesize a multi-cancel workflow merely because the low-level composite cancel capability exists.

## Boundary review

PASS:
- no raw user text consumed;
- no regex/NLU/date parsing introduced;
- no reference grounding inside Planner;
- no tool execution inside Planner;
- no direct Policy/authorization/HITL decision;
- no idempotency token generation;
- no approved-operation re-planning/resume;
- no dynamic raw ToolRegistry ranking;
- no arrays of NextSteps;
- no auto-retry after provider failure;
- no unsupported multi-room split writes;
- no modify-as-cancel+create synthesis;
- no Response Composer/prose generation;
- no runtime/orchestrator wiring.

## CI evidence

Exact head `a8c2421ea6504f4c0d16f6462c635fdf2f6a17ab`:
- locked install — PASS
- typecheck + full tests — PASS
- staging E2E runner syntax — PASS
- Cloudflare Worker config validation — PASS

## Gate result

`I3_DETERMINISTIC_PLANNER_PASS = PASS`

Implementation may advance to I4 Semantic Interpreter only after the closure bookkeeping is persisted. Runtime integration remains blocked.
