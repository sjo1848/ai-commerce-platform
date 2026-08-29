# Phase 1 Invariants

- I-01 Tenant identity comes from trusted runtime/channel context, never user message/body claims.
- I-02 Session identity is bound to tenant + actor and fails closed on mismatch/expiry.
- I-03 Model output can request only tools visible in the tenant-scoped registry.
- I-04 Policy evaluation is authoritative before tool execution.
- I-05 Side-effect tools require idempotency keys and conflicts fail closed.
- I-06 Every attempted allowed/denied/approval/failure/replay tool call is auditable.
- I-07 Core contains no direct HMS/Alquileres persistence logic.
- I-08 User-facing errors do not leak adapter/internal failure messages.
- I-09 Money in the fake HMS vertical slice remains integer cents.
- I-10 Phase 1 performs no paid/cloud production action.
