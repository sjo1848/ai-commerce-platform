# ACP 2.6.9-R2.2 — QA Review

Status: `PASS — REVALIDATED AFTER CRITIC REWORK`
Artifact A: `6fa16baa52f0d8417f2d86f2204832db8715ae58`
Exact-artifact CI: `33348863405` — PASS
Regression suite: `97/97 PASS`
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
- invented qualitative room claims such as `amplia` / `silenciosa` fail closed;
- history/fact payloads are explicitly declared data, not instructions, in response-generation prompts.

### Availability truncation semantics — PASS after critic REWORK
Independent Critic pre-review found a valid P2: the response envelope limited room details to five and also used that truncated length as `room_count`, allowing “encontré 5” when HMS might have returned more.

Fix in final Artifact A:
- `room_count` now preserves the total authoritative HMS result count;
- `shown_room_count` is emitted only when the detail list is truncated;
- both values are required grounded placeholders when truncation occurs;
- model prompt requires explicit subset disclosure;
- Core rejects a truncated model draft that does not contain subset-disclosure language;
- deterministic fallback now says total count and “te muestro las primeras N” consistently;
- two new regressions verify total-vs-shown semantics and disclosure behavior.

### Clarification boundary — PASS
- model wording may naturalize a clarification but cannot ask for business fields Core did not declare missing;
- server-detected missing required fields use the same bounded dialogue layer;
- invalid wording falls back to deterministic clarification.

### Failure behavior — PASS
- provider failure records fallback telemetry and uses deterministic grounded rendering;
- invalid model drafts record `model_fallback` rather than leaking the draft;
- existing HITL, idempotency, ownership, tenant routing and trusted guest identity regression tests remain green.

### Scope audit — PASS
PR #43 changes dialogue/router/orchestrator contracts, their tests and R2.2 orchestration evidence only. No semantic memory-v2 or multi-room execution model is introduced. R2.3–R2.5 remain outside this artifact.

## REWORK history
1. CI `33348457429`: `90/94 PASS`; four legacy assertions described the old pre-R2.2 response contract. Safety intent was retained while expectations were updated.
2. CI `33348592481`: `94/94 PASS`.
3. QA hardening added qualitative-claim rejection.
4. CI `33348680976`: `95/95 PASS` on Artifact A candidate `2c249399...`.
5. Independent Critic pre-review returned `REWORK` with one P2: truncated availability count semantics.
6. Fix + two regressions produced final candidate Artifact A `6fa16baa52f0d8417f2d86f2204832db8715ae58`.
7. CI `33348863405`: `97/97 PASS`, typecheck/E2 syntax/Wrangler dry-run PASS.

## Severity audit
- Open P0: `0`
- Open P1: `0`
- Open P2: `0`

## Verdict
`PASS`

R2.2 is ready for a fresh Pre-Critic Gate and Independent Critic review. This QA verdict does not close R2.2 and does not authorize R2.3 until critic + integration/post-merge verification complete.