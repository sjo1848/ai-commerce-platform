# ACP 2.6.8 — Real-model REWORK

Date: 2026-08-30
Status: REWORK

Staging runs:
- `33317674131`: Worker deployed with `env.AI`; deterministic-style availability passed but follow-up quote returned no HMS data.
- `33317905235`: diagnostic rerun; natural availability request returned HTTP 200 with `{"message":"¿Qué habitación u opción querés elegir?"}` instead of calling `hms.checkAvailability`.

## Finding
The real routing model can confuse an availability intent with a downstream room-selection requirement. For CHECK/availability, room/selection is not a critical argument; only dates and guest count are required.

## Required correction
Strengthen the router decision contract so critical fields are capability-specific and availability language such as `qué hay`, `tenés algo`, `hay habitaciones`, or `busco alojamiento` cannot require room/selection before the availability tool runs.

Runtime Artifact A is invalidated by this real-model correctness failure. Any runtime fix requires fresh QA, Pre-Critic and Independent Critic before another staging acceptance run.
