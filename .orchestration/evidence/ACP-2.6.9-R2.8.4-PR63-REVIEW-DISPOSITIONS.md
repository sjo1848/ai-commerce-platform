# PR #63 unresolved review disposition

Disposition is against the current working tree for the R2.8.4 RUN 1 readiness scope. Thread state is not itself a defect verdict.

| Thread discussion | Disposition | Current basis |
|---|---|---|
| r3929884157 | VALID_AND_BLOCKING → FIXED | Any non-empty structured `missing` now forces observable clarification. |
| r3929926146 | ALREADY_FIXED_NOT_RESOLVED | Current write examples carry closed mutation grounding. |
| r3929926150 | VALID_AND_BLOCKING → FIXED | Explicit structured selection must match grounded room IDs/count. |
| r3934588812 | VALID_AND_BLOCKING → FIXED | Current-turn occupancy is applied and validated before HITL. |
| r3934588825 | VALID_NONBLOCKING | Empty active-booking list fallback is cancellation-only and outside RUN 1; remains fail-closed. |
| r3934720154 | VALID_AND_BLOCKING → FIXED | Fresh read/quote promotion is distinguished from late result; semantic and room revisions are compared. |
| r3936685328 | VALID_AND_BLOCKING → FIXED | Stay provenance is filtered independently by field. |
| r3942110993 | VALID_AND_BLOCKING → FIXED | Successful fresh quote promotes its validated dates and invalidates stale grounding. |
| r3946405157 | VALID_AND_BLOCKING → FIXED | Ambiguous selection clears partial and prior room authority. |
| r3946270972 | SUPERSEDED | Deployed validation path uses serialized durable experiment reservations; legacy in-memory wrapper is not used by Worker validation. |
| r3946405159 | VALID_AND_BLOCKING → FIXED | Durable admission uses the lesser of configured run cap and daily remainder. |
| r3951012321 | VALID_AND_BLOCKING → FIXED | Uncertain provider failures retain allowance; no unproven zero consumption is released. |
| r3952870320 | VALID_AND_BLOCKING → FIXED | Positive conservative allowance is required at parser, provider, DO and stored-state boundaries. |
| r3953934992 | VALID_AND_BLOCKING → FIXED | R2.8.4 workflow is manual-only; ordinary push cannot dispatch/deploy/provider-run it. |
| r3953934998 | VALID_AND_BLOCKING → FIXED | Readiness evidence and STATUS/STATE checkpoint are updated for the final candidate. |
| r3946405162 (outdated) | ALREADY_FIXED_NOT_RESOLVED | Settlement uncertainty retains reservation and returns no successful model result. |

No thread was silently waived. Cancellation-only scope was not expanded into RUN 1. This disposition is technical evidence, not Independent Critic approval or product acceptance.
