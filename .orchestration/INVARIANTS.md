# AI Commerce Platform — Invariant Registry

## Foundation / Phase 1
- `I-01` Tenant identity comes from trusted runtime/channel context, never user message/body claims.
- `I-02` Session identity is bound to tenant + actor and fails closed on mismatch/expiry.
- `I-03` Model output can request only tools visible in the tenant-scoped registry.
- `I-04` Policy evaluation is authoritative before tool execution.
- `I-05` Side-effect tools require idempotency keys and conflicts fail closed.
- `I-06` Every attempted allowed/denied/approval/failure/replay tool call is auditable.
- `I-07` Core contains no direct HMS/Alquileres persistence logic.
- `I-08` User-facing errors do not leak adapter/internal failure messages.
- `I-09` Money remains integer cents across commerce tool contracts.
- `I-10` No production or paid-resource action is implicit in technical acceptance.

## ACP 2.5 — Controlled Reservation
- `ACP25-AUTH-001` Reservation and cancellation tools require authoritative policy approval; user/model-supplied approval metadata cannot bypass policy.
- `ACP25-HITL-001` Approval challenge is issued server-side and bound to session, tenant, actor, message fingerprint and idempotency key.
- `ACP25-HITL-002` Approval challenges expire and are single-use; concurrent/replayed consume cannot authorize a second mutation.
- `ACP25-IDEMP-001` Every reservation side effect requires a trusted idempotency key; HMS receives it only as trusted `operationToken` execution metadata.
- `ACP25-IDEMP-002` Downstream HMS idempotency is authoritative; Core does not cache away a replay/conflict that HMS must observe.
- `ACP25-TENANT-001` Tenant→hotel routing and staging actor identity are server-side trusted configuration and cannot be selected by model/user input.
- `ACP25-BOUNDARY-001` Core accesses HMS only through the Service Binding adapter and contains no booking persistence logic.
- `ACP25-CLEANUP-001` Cancellation/cleanup is separately approval-gated and HMS enforces token-bound ownership of the booking.
- `ACP25-ERROR-001` HMS failures are normalized to Core errors and internal downstream details are not leaked to the user.
- `ACP25-SCOPE-001` Scope is staging-only synthetic data: no production, payment mutation, real customer data, paid expansion or broader autonomous write capability.
- `ACP25-EVID-001` Technical PASS may only be claimed for an immutable substantive artifact with exact CI evidence and Independent Critic PASS.
