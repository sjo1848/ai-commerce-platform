# ACP 2.6.9-R2.8.4 — Late-Review Reclosure Evidence

Date: `2026-09-02`
Substage: `2.6.9-R2.8.4 — Natural Multi-Room Dialogue`
Status: `FUNCTIONAL_RECLOSURE_PASS / FRESH_PR_REVIEW_PENDING`
Human Product Acceptance: `REWORK`
R2.8.5 authorization: `BLOCKED UNTIL FRESH REVIEW + MERGE + POST-MERGE VERIFICATION`

## Why R2.8.4 was reopened

PR #58 had been merged as `f193cecb4f090020d3086e1ba98550292ef8ac03` after the real-model staging gate recovered from the historical Workers AI `3036` free-allocation blocker. After merge, the automated Codex review published two still-material findings:

1. **P1 — exact approval target correlation**: C07 accepted any `APPROVAL_REQUIRED` result without proving that the approval plan targeted the exact authoritative room IDs corresponding to 101 + 102 returned by C06.
2. **P2 — deterministic natural room-list truncation**: fallback parsing could accept `101, 102 y 103` as only 101 + 102, creating a strict-subset execution risk if later approved.

Under ACP governance, a merged PR does not waive late P1/P2 findings. R2.8.4 therefore returned to bounded `REWORK` and R2.8.5 remained blocked.

## Frozen RED

Regression commit: `43e99d7a12197330e829c9b7a3f82151703cfcd7`
Workflow run: `33641487623`
Result: **EXPECTED RED**

Foundation result:
- tests: `228`
- pass: `226`
- fail: `2`

The two failures corresponded exactly to the two late-review findings:
- natural three-room list was truncated;
- staging harness lacked exact approval-target correlation with C06 room IDs.

Staging did not execute because the foundation gate failed first.

## P2 fix — bounded natural room lists

Commit: `41e1c7557db8489d9cd787fc669e8e0dbb2e0aa9`
File: `src/core/deterministic-model.ts`

The deterministic fallback now:
- parses natural comma/conjunction room lists instead of only one/two captures;
- resolves every explicit room number only through the authoritative `availabilityRooms` mapping;
- deduplicates canonical room IDs;
- supports the existing multi-room execution bound of at most 10 unique rooms;
- fails closed to clarification if the explicit natural list exceeds that bound or any referenced room is not authoritatively resolvable;
- never treats UUID fragments as natural room numbers;
- never silently routes a strict subset of an explicit room list.

No Tool Registry, Policy/HITL, canonicalization, idempotency, ownership, tenant/actor binding or HMS authority was weakened.

## P1 fix — exact 101+102 approval correlation

Commit: `404d4f091860109d35d66176c0f6059f670b8ba9`
File: `scripts/r2.8-multi-room-dialogue.mjs`

The staging gate now:
- captures the authoritative room IDs for room numbers 101 and 102 directly from C06 HMS output;
- requires both expected IDs to exist before C06 can pass;
- exact-set compares the approval target against those C06 IDs before C07 can pass;
- records `approvalTargetsExpectedRooms` in the staging report;
- keeps compatibility with the future R2.8.5 human-readable 101/102 approval summary while preserving canonical UUIDs internally;
- still never consumes the approval in R2.8.4.

## Exact-head verification

Final functional code head: `404d4f091860109d35d66176c0f6059f670b8ba9`
Workflow run: `33641836819`

### Attempt 1 — observability transport flake

Foundation, syntax, credentials and exact-head deployment passed. The run stopped before model inference because the foreground `wrangler tail` attachment did not capture the non-LLM 404 probe. This is classified as an observability transport flake, not a product pass/fail, because the corpus was not allowed to execute.

### Attempt 2 — GREEN

Same exact code head, no code changes:
- foundation **228/228 PASS**;
- real-model staging **5/5 PASS**;
- exact approval target correlation **PASS**;
- authorized baseline model only;
- route fallbacks: `0`;
- approval consumed: `false`;
- HMS mutation requests: `0`.

### Attempt 3 — consecutive GREEN

Same exact code head, no code changes.

Worker Version ID: `4bd168cc-b957-4322-a210-0bbd29494bb6`
Artifact ID: `9851535299`
Artifact ZIP SHA256: `bfcb52edd1e15b5b85b6dc7eae154ec3378eb5341e173f49ee60b8fcabf31449`

Foundation:
- tests: **228/228 PASS**;
- harness syntax: PASS;
- credentials: PASS;
- exact-head deploy: PASS;
- foreground observability probe: PASS.

Real staging:
- `ACP_R2_8_MULTI_ROOM_DIALOGUE_PASS`;
- cases: **5/5 PASS**;
- requests: `2`;
- E2E p95: `8,979 ms`;
- `approvalTargetsExpectedRooms = true`;
- approval consumed: `false`;
- HMS mutation requests: `0`.

C06:
- real HMS transactional availability;
- 101, 102, 103 and 203 visible;
- exact C06 IDs for 101 and 102 captured server-side by the harness.

C07:
- natural request: `Quiero reservar la 101 y la 102.`;
- HTTP `409` / `APPROVAL_REQUIRED`;
- `hms.createMultiReservation` reached;
- approval target exact-set matched the C06 IDs for 101 + 102;
- no single-room collapse;
- no approval consumption;
- no mutation.

Model telemetry:
- model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` only;
- model inferences: `3`;
- route inferences: `2`;
- model fallbacks: `0`;
- route fallbacks: `0`;
- input tokens: `6744`;
- output tokens: `266`;
- provider inference p95: `4024 ms`.

Audit telemetry:
- `hms.checkAvailability` — `allowed`;
- `hms.checkAvailability` — `succeeded`;
- `hms.createMultiReservation` — `approval_required`;
- no reservation/cancellation `succeeded` or `replayed` event.

## Reclosure verdict before integration

The functional rework satisfies the strengthened R2.8.4 criterion of two consecutive exact-head real-model GREEN executions after the late-review fixes.

Current verdict:

`R2.8.4 = FUNCTIONAL_RECLOSURE_PASS / FRESH_PR_REVIEW_PENDING`

R2.8.4 is **not yet canonically CLOSED**. Required remaining steps:
1. fresh corrective PR against current `main`;
2. exact-head PR core-ci PASS;
3. fresh review with open P0/P1/P2 = `0/0/0`;
4. resolve superseded PR #58 P1/P2 threads only after the corrective evidence is accepted;
5. SHA-pinned merge;
6. post-merge `main` CI PASS;
7. final STATE/STATUS/Block Plan/Issue #20/Drive convergence.

## Carry into R2.8.5

The approval summary still exposes canonical room UUIDs. That remains an explicit next-block product defect: R2.8.5 must display server-grounded human-readable room numbers such as 101 and 102 **before approval is consumed**, while canonical plan/fingerprint data may remain UUID-based internally.

R2.8.5 must not begin until R2.8.4 is canonically closed.

## Carry into R2.8.7

Real-model latency remains a product-quality input. Latest exact-head E2E p95 was `8,979 ms`; this is not hidden by the R2.8.4 functional pass.
