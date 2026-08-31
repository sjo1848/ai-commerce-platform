# ACP 2.6.9-R2.2 — QA Review

Status: `PENDING CI`

## Review target
Natural Receptionist Dialogue Layer only.

## Required QA checks
- greeting/social/help cannot trigger operational side effects;
- social-only routes cannot mutate conversation state;
- operational facts in model-written replies originate only from `GroundedFactEnvelope` placeholders;
- unknown/missing placeholders fail closed to deterministic responder;
- raw numeric/currency/identifier values outside placeholders fail closed;
- unsupported hotel-detail claims fail closed;
- clarification wording cannot ask for fields Core did not declare missing;
- provider failure uses cordial deterministic fallback;
- existing HITL/idempotency/ownership/tenant boundaries remain unchanged;
- semantic memory v2 and multi-room remain outside R2.2 scope.

## Verdict
Pending exact CI and diff review.
