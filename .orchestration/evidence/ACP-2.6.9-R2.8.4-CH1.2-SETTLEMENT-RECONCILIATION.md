# ACP-2.6.9-R2.8.4 — CH-1.2 Settlement Reconciliation

## Verdict and authority

- Block: `CH-1.2`
- Candidate SHA: `519801ffa2ce4595c31aa1df03e5d0990c60595c`
- Parent: `4f85d9d690c5f5d4b906cfd3340a2f5c891d61d3`
- Status: completed technical bookkeeping; no closure authorized
- R2.8.4 remains `ACTIVE / ARCHITECTURAL_REWORK`.

No merge, deploy, or closure is authorized by this evidence. A CH2B retry requires a new Human Gate.

## Scope and changed files

CH-1.2 reconciles the durable experiment-budget settlement status so each persisted snapshot derives its public admission status from observed neurons, active reservation allowances, and the next conservative allowance. Explicit `COMPLETE` remains terminal. Settlement and release return the reconciled snapshot; tests cover exhaustion, release recovery, renewed reservation, and terminal preservation.

Changed files in the candidate commit:

- `src/cloudflare/session-durable-object.ts`
- `src/core/neuron-budget.ts`
- `test/neuron-budget.test.mjs`

No application files outside that explicitly scoped implementation/test change were modified by CH-1.2.

## Verification

- `npm test` / `npm run qa`: **268/268 PASS**
- Typecheck: **PASS**
- Wrangler dry-run: **PASS**
- `git diff --check` for parent-to-candidate range: **PASS**
- Engineering QA: **PASS**
- Independent Critic: **PASS**

## Safety and external-call boundary

CH-1.2 made no provider calls, Workers AI calls, staging calls, deployment calls, HMS calls, or approval calls. No HMS mutation occurred and no approval was consumed. This is offline implementation/test evidence only.

R2.8.4 remains active and technically open; this artifact does not advance R2.8.4, unblock R2.8.5, authorize merge/deploy, or declare closure. Any CH2B retry must wait for a new Human Gate.
