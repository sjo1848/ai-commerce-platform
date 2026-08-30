# ACP 2.6 — LLM Model Router / HMS Agentic Experience

Status: `AUTHORIZED FOR PLANNING`
Scope: AI Commerce Platform + HMS staging only.

## Product goal
Make the HMS experience feel like a useful AI agent rather than a command parser, while preserving every deterministic safety boundary validated in ACP 2.5.

A user should be able to speak naturally, keep context across turns, refer to prior results, receive targeted clarification when information is missing, and complete availability → quote → reserve → cancel without learning IDs or rigid syntax.

## Architectural invariant
The LLM is a planner/interpreter, not an authority.

The model MAY:
- interpret natural language and conversational context;
- classify intent;
- select only registered tools;
- propose structured tool arguments;
- request clarification;
- compose natural-language responses from verified tool results.

The model MUST NOT:
- set tenant, hotel, actor, permissions, service credentials or trusted routing;
- set approval metadata, approval fingerprints or `operationToken`;
- bypass Tool Registry, server-side input validation, Policy Engine, HITL or idempotency;
- read/write HMS persistence directly;
- invent operational facts when a tool result is required;
- broaden its own tool set or permissions.

## Execution sequence
### 2.6.1 — Conversational acceptance corpus
Freeze representative natural and adversarial conversations before implementation. Include relative wording, omitted fields, corrections, multi-turn references and ambiguous requests.

### 2.6.2 — Model Provider Adapter
Introduce a provider-independent adapter and `LLMModelRouter` implementing the existing `ModelRouter` interface. Keep `DeterministicModelRouter` as deterministic fallback/test fixture, not the primary user experience.

### 2.6.3 — Structured tool planning
Expose only registered tool descriptors to the model. Parse model output into a strict plan schema, reject unknown tools/fields, and revalidate all arguments server-side before execution.

### 2.6.4 — Operational conversation context
Persist safe session context needed to resolve references such as “la segunda”, “esa habitación”, “reservala” or “cancelá esa”. LLM memory is never the operational source of truth; authoritative IDs/results remain server-side evidence.

### 2.6.5 — Clarification + response composition
When critical information is missing or ambiguous, ask a minimal clarification instead of guessing. Natural responses must be grounded in tool outputs for availability, price, booking and status facts.

### 2.6.6 — Usage, latency, cost and fallback
Instrument model calls, token/input-output usage where available, latency and model failures per tenant/session. Define timeouts, bounded retries and safe fallback. Model failure must never relax authorization or mutation controls.

### 2.6.7 — Adversarial QA + Independent Critic
Cover prompt/tool injection, forged trusted fields, tenant/hotel spoofing, hallucinated operational facts, ambiguous references, malformed model plans, unknown tools, model timeout/error, HITL bypass attempts and replay/idempotency regressions.

### 2.6.8 — Conversational staging E2E
Run full natural-language HMS staging conversations through the real model route: discover options → quote → select by conversational reference → reserve with HITL → verify booking/inventory → cancel with separate HITL → verify restoration.

### 2.6.9 — Human Product Acceptance
Human gate question: does this now feel like a useful, trustworthy AI hotel agent rather than a parser/form interface?

Required verdict: `ACCEPT` or `REWORK`.

## Exit criteria
- Natural language works without rigid command syntax for representative scenarios.
- Multi-turn context and safe reference resolution work.
- Ambiguity triggers clarification, not guessing.
- Operational claims are tool-grounded.
- Create/cancel retain all ACP 2.5 controls.
- Prompt injection cannot elevate authority or trusted context.
- Model outages/timeouts fail safely.
- Usage, latency and cost telemetry is available.
- Exact-artifact CI and adversarial QA PASS.
- Independent Critic PASS.
- Conversational staging E2E PASS.
- Human Product Acceptance: ACCEPT.

## Gate to Fase 3 — Alquileres
Fase 3 remains blocked until ACP 2.6 closes with Human Product Acceptance. The second vertical must reuse the same Agent Core + LLM Model Router and change primarily domain adapter/tools/truth semantics. That reuse is the platform proof.

## Still forbidden
Production cutover, real customer data, payments, paid-resource expansion, WhatsApp as a mandatory 2.6 dependency, new autonomous side effects outside the 2.5 contract, or expansion to another vertical before this gate closes.
