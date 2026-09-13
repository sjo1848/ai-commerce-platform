# ACP-3.0.8.3 — Hotel TaskDefinition + Deterministic Planner Evidence

Status: `DETERMINISTIC_PLANNER_IMPLEMENTATION_PASS`

## Exact gate

- exact head: `a8c91bd67fbcb1125a8f9f5daa4c97e6c6ce5102`
- core-ci: #646 / `34762367166`
- result: PASS
- typecheck/tests: PASS
- staging E2E runner syntax: PASS
- Cloudflare Worker config: PASS

## Initial candidate and Review 01

Initial candidate `bd387bca6214e62ded3c690ffa6de5678a53648f` failed core-ci #644 / `34756688665` because `planning.ts` was published with malformed TypeScript signatures. The failed candidate was not gated.

Final contradiction review also found and closed:
- abort could not claim success before durable intent/prepared-operation cleanup;
- social/help/ack must be serviced without advancing workflow or consuming approval;
- `approval_invalidated` must not silently regenerate the write proposal.

The corrected head preserves the prior deterministic planner behavior and adds fail-closed guards for those boundaries.

## Verified invariants

- exactly one bounded NextStep;
- no raw text, regex/NLU or date parsing in Planner;
- no policy/approval decisions or side effects;
- every CALL_TOOL has grounded input + precondition fingerprint;
- write fingerprint includes `operationIntent` semantics;
- reads can be serviced while approval is pending;
- no automatic retry;
- no multi-write decomposition when native multi capability is absent;
- no implicit RAG/knowledge capability;
- cancel/modify remain fail closed until server-owned `groundedBookingTarget` exists.

No real provider inference, deployment, HMS mutation or approval consumption occurred.
