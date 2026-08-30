# ACP 2.6 — Adversarial QA Evidence

Status: `PASS — READY FOR PRE-CRITIC`
Date: 2026-08-30
Substage: `2.6.7 — Adversarial QA`
Substantive Artifact A: `56ba62d5fc903ce2c387e5bf91d4f1b89b1e700e`
CI: `core-ci` run `33317116664` — **SUCCESS**

## Gate result

The exact substantive candidate completed:

- TypeScript strict typecheck;
- **73/73 Node tests PASS**;
- staging E2E runner syntax validation PASS;
- Wrangler Worker dry-run PASS;
- generated Cloudflare bindings include `env.AI`, `env.HMS` and `env.SESSIONS`.

Zero automated failures remain on Artifact A.

## Threat / invariant matrix

| Threat / invariant | Enforced by | Evidence |
| --- | --- | --- |
| Prompt injection selects internal tool | visible-tool boundary + orchestrator recheck | `test/adversarial.test.mjs`, `test/llm-model.test.mjs` |
| Model selects non-visible / unknown tool | Tool Registry + LLM router + executor boundary | `test/adversarial.test.mjs`, `test/llm-model.test.mjs` |
| Tenant/hotel spoofing | fixed tenant + trusted HMS route | `test/adversarial.test.mjs`, `test/hms-service-binding.test.mjs` |
| Model sets trusted execution metadata | recursive trusted-field rejection; server metadata only | `test/llm-model.test.mjs`, `test/model-telemetry.test.mjs` |
| Model/request selects guest identity | `guestId` absent from model schema; tenant+actor mapping injected before fingerprint | `test/hms-agent-identity.test.mjs`, `test/trusted-guest-identity.test.mjs` |
| Missing guests/dates/reference are guessed | structured clarification route + schema-aware deterministic fallback | `test/deterministic-model.test.mjs`, `test/llm-model.test.mjs` |
| Model invents room/booking IDs | grounded planning + executor/domain checks | `test/webchat.test.mjs`, `test/llm-model.test.mjs`, `test/reservation-control.test.mjs` |
| Unknown/malformed model arguments | schema allowlist + executor revalidation | `test/llm-model.test.mjs` |
| Provider failure/timeout relaxes safety | 8s deadline, zero automatic retries, deterministic fallback | `test/workers-ai-provider.test.mjs`, `test/model-telemetry.test.mjs` |
| Response model invents operational facts | facts rendered deterministically; LLM can only choose bounded CTA/style | `test/model-responder.test.mjs`, `test/model-telemetry.test.mjs` |
| Tool memory leaks trusted metadata | recursive redaction before persistence | `test/conversation-context.test.mjs` |
| Client supplies conversation authority | server-owned bounded conversation store | `test/conversation-context.test.mjs` |
| Reservation self-approves | Policy Engine + trusted approval metadata only | `test/reservation-control.test.mjs` |
| Approval reroutes probabilistically | exact validated canonical plan stored in challenge; approve executes stored plan | `test/reservation-control.test.mjs` |
| Guest changes after approval | trusted identity canonicalized before fingerprint and rechecked before mutation | `test/hms-agent-identity.test.mjs`, `test/trusted-guest-identity.test.mjs` |
| Challenge replay/substitution | session/tenant/actor/message/idempotency binding + single use | `test/reservation-control.test.mjs` |
| Side effect without idempotency | executor requires trusted key | `test/idempotency.test.mjs`, `test/reservation-control.test.mjs` |
| Cancel arbitrary booking | session ownership binding + original create token | `test/reservation-control.test.mjs` |
| Model cost invisible | inference telemetry records model/tokens/latency/cost/log ID and fallback reason | `test/model-telemetry.test.mjs`, `test/workers-ai-provider.test.mjs` |

## Prior artifact invalidation

The earlier Pre-Critic candidate `ad794989d2299a99ad8aae46689411c6d55915fa` was invalidated because later commits modified runtime and tests. It is not used as current critic evidence.

## Known bounded limitations

1. A timed-out provider request may still incur remote cost; no automatic retry is attempted.
2. A second bounded inference currently selects presentation CTA/style; its value versus latency/cost must be measured in 2.6.8.
3. `visitor-demo -> guestId` is synthetic staging identity, not production identity architecture.
4. Real-model natural-language correctness is not claimed by unit tests; the >=90% conversational target must be measured in 2.6.8.

## QA verdict

`PASS` for automated/adversarial implementation QA on Artifact A `56ba62d...`.

This is not Product Acceptance or Production Eligibility and does not unblock Fase 3.