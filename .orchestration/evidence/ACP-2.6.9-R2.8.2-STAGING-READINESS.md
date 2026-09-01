# ACP 2.6.9-R2.8.2 — Staging Readiness Evidence

Status: `STAGING_READY / PASS`
Date: `2026-09-01`
Scope: read-only staging readiness only. No HMS reservation/cancellation mutation was executed.

## Exact readiness artifact

Final readiness head:
`af160ffe57afc77276e9b3420690072093b46d1c`

Final workflow:
- name: `R2.8 staging readiness`
- run: `33518889386` / run #2
- conclusion: **SUCCESS**
- artifact: `r2.8-staging-readiness-33518889386`
- artifact ID: `9804817790`
- artifact ZIP SHA-256: `6d0090838722eea8154ccaeca28920764f6ea28314a89e74de80ec693e1664d6`

## Readiness rework history

R2.8.2 first exposed a real observability gap: `AgentCoreRuntime` hard-wired `InMemoryAuditSink`, so real staging audit evidence could not be captured externally.

The gap was frozen red in `test/audit-observability-r2.8.test.mjs`:
- initial PR CI run `33518143681`
- **216/217 PASS / 1 expected FAIL**
- only failure: missing `ConsoleAuditSink` / injectable runtime audit sink.

Bounded fix:
- add structured `ConsoleAuditSink`;
- make `AuditSink` injectable in `AgentCoreRuntime`;
- wire `ConsoleAuditSink` only through the Worker runtime;
- no change to Tool Registry, Policy, HITL, canonical fingerprints, idempotency, ownership or HMS authority.

The first real readiness workflow run `33518688479` reached a valid staging readiness result but the workflow itself ended red because a raw `grep` did not account for JSON escaping in `wrangler tail`. Product/environment evidence was already present. The false-negative assertion was replaced with the existing structured model-telemetry parser and token checks. No product behavior was relaxed.

## Foundation and bindings

Final run foundation:
- tests: **218/218 PASS**
- typecheck: PASS
- readiness script syntax: PASS
- Wrangler dry-run: PASS

Verified bindings:
- `AI` — Workers AI
- `SESSIONS` — `SessionDurableObject`
- `HMS` — `hms-cloudflare-api-staging#AgentHmsService`

Staging Worker:
- name: `ai-commerce-agent-core`
- URL: `https://ai-commerce-agent-core.sjo1848.workers.dev`
- deployed version: `a6df6054-1918-4c1b-88bf-da50b4e405f0`

## Authorized model evidence

Expected and observed model:
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`

Observed model telemetry:
- model inferences: `4`
- model fallbacks: `2`
- fallback ratio: `0.3333333333333333`
- input tokens: `5992`
- output tokens: `305`
- estimated cost: `USD 0.002442821`
- latency min: `1887 ms`
- latency median: `2517 ms`
- latency p95/max: `7951 ms`
- fallback reasons:
  - `invalid_tool_plan_shape`: `1`
  - `invalid_conversational_draft`: `1`

These fallbacks do **not** block `STAGING_READY`: this gate proves environment, observability and authoritative read-only HMS readiness. They are explicitly carried forward as product-quality evidence for R2.8.3 and R2.8.7; they must not be hidden or normalized away.

## Durable session and HMS readiness

The readiness harness established one server-issued session and continued within that session.

Natural probe:
`¿Tenés habitaciones para dos?`

Required behavior passed:
- guest count was retained as 2;
- dates were safely clarified;
- guest count was not redundantly re-requested.

Bounded future-window scan found the required acceptance-class data on the first window:
- check-in: `2030-01-01`
- check-out: `2030-01-03`
- HMS source: `hms`
- truth: `transactional`
- available room numbers included: `101`, `102`, `103`, `203`

Verification-only canonical IDs:
- room `101`: `11000000-0000-0000-0000-000000000001`
- room `102`: `11000000-0000-0000-0000-000000000002`

These IDs are evidence only and remain forbidden as required guest-facing natural-language input.

## Audit / usage evidence

Structured audit events captured from the exact deployed Worker:
- `hms.checkAvailability` → `allowed`
- `hms.checkAvailability` → `succeeded`

No audit event referenced:
- `hms.createReservation`
- `hms.createMultiReservation`
- `hms.cancelReservation`
- `hms.cancelMultiReservation`

The readiness report records:
`hmsMutationRequests: 0`

Console usage evidence was parsed successfully for message, model route/inference/fallback and `hms.checkAvailability` tool call.

## Gate verdict

`STAGING_READY / PASS`

R2.8.2 proves the controlled staging environment is ready for the frozen R2.8 corpus. It does not itself prove receptionist product quality and does not authorize any production or second-vertical action.

Next authorized block only:
`R2.8.3 — Natural read-only conversation` → gate `CONVERSATION_PASS`.
