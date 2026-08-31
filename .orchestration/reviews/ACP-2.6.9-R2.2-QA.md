# ACP 2.6.9-R2.2 — QA Review

Status: `PASS`
Artifact A: `2c2493999b5e958ed74005082bb88108e04c3b62`
Exact-artifact CI: `33348680976` — PASS
Regression suite: `95/95 PASS`
Typecheck: `PASS`
Staging E2 runner syntax: `PASS`
Wrangler dry-run: `PASS`

## Review target
Natural Receptionist Dialogue Layer only.

## QA findings

### Conversational routing — PASS
- pure greeting/social/help are classified separately from operational intents;
- a greeting combined with an operational request remains operational;
- social-only routes with `missing` or `statePatch` are rejected to deterministic fallback;
- social turns therefore cannot trigger or mutate operational state through the new route class.

### Grounded natural generation — PASS
- operational values originate in a server-built `GroundedFactEnvelope`;
- the model may write connective prose only around opaque placeholders;
- Core validates the draft before server-side placeholder hydration;
- unknown placeholders fail closed;
- missing required placeholders fail closed;
- raw numeric/currency/identifier values outside placeholders fail closed;
- raw copies of authoritative fact values outside placeholders fail closed;
- trusted execution fields fail closed;
- unsupported amenities/policies fail closed;
- QA added a specific REWORK hardening for invented qualitative room claims such as `amplia` / `silenciosa`; those now fail closed as well;
- history/fact payloads are explicitly declared data, not instructions, in response-generation prompts.

### Clarification boundary — PASS
- model wording may naturalize a clarification but cannot ask for business fields Core did not declare missing;
- server-detected missing required fields use the same bounded dialogue layer;
- invalid wording falls back to deterministic clarification.

### Failure behavior — PASS
- provider failure records fallback telemetry and uses deterministic grounded rendering;
- invalid model drafts record `model_fallback` rather than leaking the draft;
- existing HITL, idempotency, ownership, tenant routing and trusted guest identity regression tests remain green.

### Scope audit — PASS
PR #43 changed dialogue/router/orchestrator contracts, their tests and R2.2 orchestration evidence only. No `conversation-state.ts`, HMS adapter contract or multi-room execution model was changed. R2.3–R2.5 remain outside this artifact.

## REWORK history
Initial PR CI `33348457429` produced `90/94 PASS`; the four failures were legacy test expectations for the pre-R2.2 response contract, not compiler/runtime defects. Those tests were rewritten to retain their safety invariants under the new natural grounded response contract.

A second green run `33348592481` produced `94/94 PASS`. QA then identified one additional grounding weakness: qualitative room claims without numeric data could pass. The implementation was hardened and a regression added.

Final Artifact A `2c2493999b5e958ed74005082bb88108e04c3b62` passes `95/95` in run `33348680976`.

## Severity audit
- Open P0: `0`
- Open P1: `0`
- Open P2: `0`

## Verdict
`PASS`

R2.2 is ready for Pre-Critic Gate. This QA verdict does not close R2.2 and does not authorize R2.3 until Independent Critic + integration/post-merge verification complete.