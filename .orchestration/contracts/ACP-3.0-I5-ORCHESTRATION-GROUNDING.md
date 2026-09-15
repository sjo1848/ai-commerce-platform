# ACP-3.0 I5 — Orchestration + Bounded Grounding

Status: `I5_ORCHESTRATION_GROUNDING_PASS = PASS`
Block: `I5 = CLOSED`
Date: `2026-09-15`

## Authority

- Base: `a65fc4bd437fc99e922548aa8917135ba3821263` — authoritative I4 closure.
- Substantive I5 head: `7d3f1ac2a70c3bb6294cc2678a7021a41c7155d3`.
- Exact substantive validation: `core-ci #743 = PASS` on that exact SHA.
- This gate authorizes the next incremental implementation block only. It does not authorize production cutover, deployment, provider-backed real-journey execution or HMS side effects.

## Implemented boundary

```text
accepted typed primary cause + durable OrchestrationCycleRecord
→ TaskState Reducer
→ post-reducer TaskState
→ bounded server Reference Resolver
→ zero to two INTERNAL_PREPLAN grounding controls
→ Reducer
→ post-grounding TaskState
→ PlanningTrigger preserving the original primary cause/directives
→ Deterministic Planner
→ exactly one bounded NextStep
```

I5 does not execute the resulting NextStep. Core/Policy/Executor/tool admission and observation mapping remain the responsibility of the following implementation block.

## Locked invariants

1. Reducer remains the only durable TaskState transition authority.
2. Reference Resolver is deterministic, server-owned, model-free and I/O-free.
3. Reference Resolver never mutates TaskState directly; accepted grounding enters only through typed `ServerControlEvent` → Reducer.
4. Internal grounding is `INTERNAL_PREPLAN` and cannot become an independent primary cycle or replace the external primary cause.
5. The normalized PlanningTrigger retains the original user/tool/server cause, correlation and accepted ephemeral directives.
6. Planner is invoked at most once per active planning cycle and receives only post-reducer/post-grounding TaskState plus the normalized trigger.
7. `STATE_ONLY` and `TERMINAL_NO_PLAN` controls close their cycle without Planner.
8. `RESUME_EXECUTION` returns only a bounded disposition. I5 performs no write execution and does not replan an approved mutation.
9. Unknown/unclassified server control dispositions fail closed.
10. Internal grounding is bounded to at most two controls in v1: room selection and booking target.
11. `OrchestrationCycleRecord` stores server-owned ephemeral directives so a crash never requires reparsing historical user language.
12. A `planned` cycle stores the bounded deterministic `NextStep` and its state revision so recovery never invokes Planner merely to reconstruct a lost handoff.
13. Stable internal grounding event IDs are derived from `cycleId + grounding type`, supporting duplicate-safe crash recovery.
14. DialogueAnchor distinguishes the published candidate set, published focus and published selection. These conversational handles are not operational grounding truth.
15. `current_selection`, `focused_entity`, `presented_set`, `other` and `both` resolve only against bounded published context that is consistent with the current authoritative observation.
16. A direct visible room number may resolve against current authoritative availability without a presentation anchor, but duplicate visible numbers fail closed.
17. Room and booking contextual scopes remain typed and cannot cross-ground one another.
18. Malformed published anchor context is rejected by the closed TaskState schema and also fails closed inside the Resolver if invoked outside the normal typed route.
19. Corrections reduce first and causally invalidate stale availability/grounding/anchors before any new grounding attempt.
20. ToolObservationEvent can be the primary cause; fresh tool truth is reduced before grounding and Planner.
21. No raw user text, provider payload, prompt output, RAG result or dynamic tool ranking enters the Planner boundary.
22. No production `orchestrator.ts`, Core, Policy, Executor, HMS adapter, model-provider or deployment path was changed by I5.

## Adversarial findings closed

### F1 — DependencyPath tuple inference
Initial resolver code widened conditional dependency arrays to `string[]`. Fixed mechanically with explicit bounded `DependencyPath[]`. No contract change.

### F2 — PLANNING_TRIGGER double reduction
An early kernel path could reduce a planning server control and then fall through to the generic primary reduction. Fixed so every primary cause is reduced exactly once.

### F3 — Crash after primary reduction
A persisted `reduced` cycle now resumes only when the TaskState already records the accepted primary event. It never reapplies user semantics.

### F4 — Crash after internal grounding
Stable grounding event identities plus state-aware resolver behavior prevent duplicate material grounding after recovery.

### F5 — Reducer committed but cycle-status update lost
An `accepted` cycle can safely encounter an already-applied primary event through Reducer duplicate-idempotency and continue without reinterpreting text.

### F6 — Contextual reference lost by reduce-before-ground
A new user reference correctly invalidates prior operational grounding before Resolver runs. Therefore `current_selection` / `focused_entity` / `other` cannot depend on old GroundedSelection. DialogueAnchor was extended with server-owned `focusedCandidate` and `selectedCandidates`, separate from `candidateScope`, so published conversational context survives while operational grounding remains invalidatable.

### F7 — Closed TaskState schema lagged behind DialogueAnchor contract
`task-state-schema-boundary.ts` initially rejected the new focus/selection fields. The owner boundary was updated explicitly; arbitrary extra fields remain prohibited.

### F8 — Cycle recovery still depended on caller PlanningTrigger
The cycle already persisted accepted directives, so requiring the caller to reconstruct a trigger after a crash contradicted the recovery contract. The kernel can now rebuild the normalized trigger from the durable cycle record itself.

### F9 — Planned NextStep could be lost after crash
`OrchestrationCycleRecord` now persists `plannedStep` plus `plannedAtStateRevision`. A recovered planned cycle returns that exact bounded step instead of invoking Planner again.

### F10 — Malformed anchor could throw in direct Resolver use
Resolver now validates arrays/strings defensively and returns unresolved rather than throwing.

### F11 — STATE_ONLY / TERMINAL_NO_PLAN cycle could remain open
These paths now transition the cycle to `completed`, preventing accidental replay/planner loops.

### F12 — Primary cause preservation under tool result / correction / mixed directives
Adversarial tests confirm tool result remains the primary cause; date correction wins before grounding; and read/abort/commit directives retain their bounded semantics without becoming hidden workflow logic.

## Evidence

I5-specific suites include:

- `acp-3.0-orchestration-cycle.test.mjs`
- `acp-3.0-orchestration-recovery.test.mjs`
- `acp-3.0-reference-resolver-context.test.mjs`
- `acp-3.0-orchestration-adversarial.test.mjs`
- `acp-3.0-orchestration-cycle-record.test.mjs`
- `acp-3.0-orchestration-final-hardening.test.mjs`

The exact substantive head also passed all pre-existing I1–I4 and legacy safety/regression tests under `core-ci #743`.

## Scope audit

Diff from I4 closure to substantive I5 head changes only:

- `src/cognitive/contracts.ts`
- `src/cognitive/reference-resolver.ts`
- `src/cognitive/orchestration-cycle.ts`
- `src/cognitive/task-state-schema-boundary.ts`
- I5 test suites

No production orchestration cutover occurred.

## Gate

`I5_ORCHESTRATION_GROUNDING_PASS = PASS`

`I5 = CLOSED`, conditional only on exact-head closure CI for this documentation commit.

Next allowed block: incremental Core/Tool integration starting from the exact I5 closure SHA. Production runtime wiring, deployment, provider-backed J01 and real HMS side effects remain blocked until their own gates.