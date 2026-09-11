# R2.8.4 RUN 1 — 34260151792

Status: `RUN_1_FAILED`

## Identity

- PR: `#63`
- Candidate SHA: `e7afc21fb82a8423ce3a3d638a6868a1111e796f`
- Workflow run: `34260151792`, attempt `1`
- Experiment ID: `r28-34260151792-1`
- Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Affinity: `OFF`
- Configured budget: `7000/7000/0/180`
- Deployed Worker Version: `fcb24c21-f818-402c-98ac-3af11252a33b`
- Evidence artifact: `r2.8-multi-room-dialogue-34260151792`

## Pre-inference gate

- Foundation gate: PASS.
- Validation admission configuration: PASS.
- Exact deployment: PASS.
- Exact active deployment correlation: PASS; version was 100% active.
- Zero-inference admission probe: **FAIL**.
  - Expected HTTP `403`.
  - Observed HTTP `404`.
  - Sanitized body: `{"error":{"code":"NOT_FOUND"}}`.
  - Probe path: `/__r28-tail-probe?run=34260151792-1`.
- Historical observability query for this RUN 1: `SKIPPED_AFTER_ZERO_INFERENCE_PROBE_FAILURE`.

The contractual failure policy stopped the run before provider execution. No
retry or rescue request was issued.

## Functional results

- C06: `NOT_STARTED`.
- C07: `NOT_STARTED`.
- Occupancy follow-up: `NOT_STARTED`.
- L01-L15: `NOT_STARTED`.
- Authoritative grounding: `NOT_REACHED`.
- `hms.createMultiReservation` / `APPROVAL_REQUIRED`: `NOT_REACHED`.

## Telemetry and consumption

- Model telemetry: `NOT_CAPTURED_PROVIDER_NOT_STARTED`.
- Audit telemetry: `NOT_CAPTURED_PROVIDER_NOT_STARTED`.
- Provider calls: `UNKNOWN_NOT_CAPTURED`.
- Provider neurons: `UNKNOWN_NOT_CAPTURED`.
- Budget reconciliation: `UNKNOWN_NOT_CAPTURED`.
- Missing telemetry is not treated as zero.
- This is not classified as `QUOTA_BLOCKED`.

## Mutation safety and cleanup

- Approval consumed: `false`.
- HMS mutation: none initiated by control flow.
- No provider-backed Worker request occurred.
- Cleanup completed successfully.
- Temporary validation configuration was removed.
- Cleanup deployment Worker Version: `0457d5a7-2da4-4002-88e8-faeef375615d`.

## Disposition

`RUN_1_FAILED` due to the zero-inference admission probe returning HTTP 404
instead of the required HTTP 403. The remaining blocker is the broken
admission-probe route/behavior on the exact deployed Worker, not provider quota.

No RUN 2, retry, `/api/approve`, HMS mutation, optimization, CH-1.4, merge or
R2.8.4 closure is authorized by this evidence.
