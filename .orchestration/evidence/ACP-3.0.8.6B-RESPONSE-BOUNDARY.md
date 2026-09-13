# ACP-3.0.8.6.B — Response Boundary Evidence

Status: `RESPONSE_BOUNDARY_PASS`
Gate head: `373bc9c99a5aa74ffff1cfc299c4921b46475a26`
Authoritative CI: core-ci #655 / `34771062223`
Tests: `501/501 PASS`
Runtime cutover: `false`
Provider calls: `false`
Channel delivery: simulated/offline only

## Scope proven

The ACP-3 response path is now bounded as:

`TaskState + NextStep -> server ResponseContextBuilder -> ResponseContext -> deterministic Renderer -> causal publication admission -> output-accepted publication event -> Reducer -> durable DialogueAnchor/PendingClarification`

## ResponseContext boundary

- Renderer receives only `ResponseContext`, never raw tool payloads or full TaskState.
- Presentation entities expose semantic/user-visible room or booking identity and preserve server-owned order; internal room IDs are absent from ResponseContext.
- `responseDependencyFingerprint` is an opaque SHA-256 receipt, so dependency material such as internal room IDs cannot leak through a readable fingerprint.
- Quote amount/currency and booking codes are inserted only from grounded TaskState observations.
- HMS `guestCapacityCoverage=not_modeled` is surfaced as an explicit limitation instead of silently asserting guest capacity.
- questionSpec is copied from Planner ASK authority. Renderer cannot invent a reservation/commit question.

## Causal freshness

- Publication admission recomputes the dependency projection against current TaskState.
- A global `stateRevision` change alone does not make a response semantically stale when its causal dependencies are unchanged.
- Changed availability/quote/approval/operation dependencies reject the old response as stale.
- `stateRevision` remains the publication concurrency guard: if state changes after admission but before commit, the `response_published` event is rejected with `STATE_REVISION_CONFLICT`.
- After an unrelated revision race, the same candidate may be re-admitted only after its causal fingerprint is revalidated against the new state.

## Publication / dialogue control

- Rendering creates no durable DialogueAnchor or PendingClarification.
- `channelAccepted=false` creates no publication event and no conversational control state.
- After channel acceptance, a revision-guarded `response_published` server event activates the exact anchor/pending clarification through the reducer.
- The reducer requires responseId/fingerprint binding for pending clarification metadata.
- An older admitted publication cannot overwrite a newer anchor because its revision guard fails.
- Later ordinal grounding uses the semantic entities from the actually published anchor, not generated prose.

## Rendering

Operational rendering is deterministic/bounded in v1. Critical success/failure/approval/no-results/degrade messages are constructed from allowed context only. No free operational LLM text is introduced.

## CI evidence

core-ci #655 / `34771062223` passed:
- Typecheck and tests
- `501/501` tests
- staging E2E runner syntax
- Wrangler dry-run

The new response-boundary tests cover internal-ID exclusion, capacity limitation, question authority, quote grounding, approval staleness, causal vs revision freshness, output acceptance, publication race, re-admission, stale overwrite protection and published-anchor ordinal grounding.

## Verdict

`RESPONSE_BOUNDARY_PASS`

`ACP-3.0.8.6` remains active until a full offline observation-to-publication integration test proves the complete post-tool loop in one chain.