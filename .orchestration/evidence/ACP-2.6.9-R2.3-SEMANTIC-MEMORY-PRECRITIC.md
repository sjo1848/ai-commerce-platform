# ACP 2.6.9-R2.3 — Durable Semantic Memory v2 — Pre-Critic Gate

Status: `PASS`
Substantive Artifact A: `3f3dbd60b781df08a0737018b17aa6832b443362`
Exact-head CI: `33354772625` — PASS (`117/117` tests)
QA evidence: `.orchestration/evidence/ACP-2.6.9-R2.3-SEMANTIC-MEMORY-QA.md`

## Gate checks
- R2.3 contract exists and scope remains single-stay semantic memory: PASS
- R2.4/R2.5 multi-room behavior not implemented in this PR: PASS
- current user facts become durable before model routing: PASS
- LLM cannot persist dates/guest count by semantic statePatch: PASS
- user corrections have deterministic precedence: PASS
- explicit clears are represented by durable tombstones: PASS
- stale tool results cannot resurrect cleared/corrected stay facts: PASS
- room grounding is invalidated when stay semantics change/stale: PASS
- concurrent snapshots merge without dropping non-conflicting facts: PASS
- scope metadata is server-owned and cross-scope reuse fails closed: PASS
- model-visible state excludes trusted scope/provenance/revision metadata: PASS
- preference memory is bounded and instruction/prompt poison is rejected: PASS
- existing Policy/HITL/idempotency/ownership/trusted-routing behavior unchanged: PASS
- P0/P1/P2 open against Artifact A: `0/0/0`

No substantive changes are authorized after Artifact A without invalidating this gate and re-running QA + Pre-Critic.

Verdict: `PRE_CRITIC_PASS`
