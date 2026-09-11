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
- `ACP25-HITL-001` Approval challenge is server-issued and bound to session, tenant, actor, message, idempotency key and the exact validated `toolId + input` operation fingerprint.
- `ACP25-HITL-002` Approval challenges expire and are single-use; concurrent/replayed consume cannot authorize a second mutation.
- `ACP25-HITL-003` A rerouted or otherwise changed tool operation after approval fails closed before any RPC mutation; invalid tool input cannot receive an approval challenge.
- `ACP25-IDEMP-001` Every reservation side effect requires a trusted request idempotency key; create forwards it to HMS only as trusted `operationToken` execution metadata.
- `ACP25-IDEMP-002` Downstream HMS idempotency is authoritative; Core does not cache away a replay/conflict that HMS must observe.
- `ACP25-AUDIT-001` An authoritative downstream `replayed: true` result is recorded as `replayed` in Core audit rather than as a fresh success.
- `ACP25-TENANT-001` Tenant→hotel routing and staging actor identity are server-side trusted configuration and cannot be selected by model/user input.
- `ACP25-BOUNDARY-001` Core accesses HMS only through the Service Binding adapter and contains no booking persistence logic.
- `ACP25-CLEANUP-001` Successful create binds booking ownership to the original create operation token in trusted server-side storage keyed by session + tenant + actor + booking.
- `ACP25-CLEANUP-002` Cancellation is separately approval-gated and may use a new cancellation request idempotency key, but HMS receives only the stored original create token; cancellation fails closed without a matching trusted ownership binding.
- `ACP25-CLEANUP-003` The deployed Worker uses Durable Object storage for reservation ownership so cleanup does not depend on process-local memory.
- `ACP25-ERROR-001` HMS failures are normalized to Core errors and internal downstream details are not leaked to the user.
- `ACP25-SCOPE-001` Scope is staging-only synthetic data: no production, payment mutation, real customer data, paid expansion or broader autonomous write capability.
- `ACP25-EVID-001` Technical PASS may only be claimed for an immutable substantive artifact with exact CI evidence and Independent Critic PASS.

## ACP 2.6.9-R2.8.4 — NLU boundary rework
- `R28-NLU-001` Sólo el LLM puede derivar desde lenguaje natural abierto intención/referencias semánticas que influyan en una operación mutativa. El procesamiento mecánico determinista y el routing read-only siguen permitidos.
- `R28-NLU-002` Production fallback never produces or passes through a `ToolPlan` with `risk:write`; any associated `statePatch` is discarded and the result is safe clarification/non-operational messaging.
- `R28-GROUND-001` Core validates and grounds room selection and occupancy all-or-nothing against authoritative state; incomplete, ambiguous, stale or partial grounding fails closed.
- `R28-GROUND-002` A valid current selection replaces prior selection state; stale rooms are not merged into a new operation.
- `R28-EVID-001` Natural-language room references are evidenced by the LLM corpus; R2.8.4 staging must correlate exact C06 authoritative rooms to C07 and verify the exact deployed Version ID before accepting evidence.
- `R28-NLU-003` Every mutating plan carries one valid closed `mutationGrounding` variant; missing, duplicate, unknown, stale, mismatched or text-overridden grounding fails closed before write planning.
- `R28-NLU-004` Clarification responses are observable as `outcome: "clarification"` with explicit missing fields; status code or prose alone is insufficient.
