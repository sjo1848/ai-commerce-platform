# ACP 2.6 — Adversarial QA Evidence

Status: `PASS — READY FOR PRE-CRITIC`
Date: 2026-08-30
Substage: `2.6.7 — Adversarial QA`
Substantive Artifact A: `ad794989d2299a99ad8aae46689411c6d55915fa`
CI: `core-ci` run `33316738878` — **SUCCESS**

## Gate result

The exact substantive candidate completed:

- TypeScript strict typecheck;
- 69/69 Node tests PASS;
- staging E2E runner syntax validation PASS;
- Wrangler Worker dry-run PASS;
- generated Cloudflare bindings include `env.AI`, `env.HMS` and `env.SESSIONS`.

Zero automated failures remain on Artifact A.

## Threat / invariant matrix

| Threat / invariant | Enforced by | Evidence |
| --- | --- | --- |
| Prompt injection selects internal tool | Router visible-tool boundary + deterministic fallback injection guard | `test/adversarial.test.mjs` — prompt injection cannot select arbitrary internal tool |
| Model selects non-visible / unknown tool | `ToolRegistry.descriptorsFor` + orchestrator visibility recheck + LLM router check | `test/adversarial.test.mjs`, `test/llm-model.test.mjs` |
| Tenant/hotel spoofing | fixed deployment tenant + trusted HMS route | `test/adversarial.test.mjs`, `test/hms-service-binding.test.mjs` |
| Model sets trusted execution metadata | recursive trusted-field rejection; metadata only supplied by channel/runtime | `test/llm-model.test.mjs`, `test/model-telemetry.test.mjs` |
| Request/model selects another guest identity | `guestId` absent from model schema; trusted actor mapping injected before canonicalization; execution recheck | `test/hms-agent-identity.test.mjs`, `test/trusted-guest-identity.test.mjs` |
| Missing critical guest count is guessed | schema-aware fallback asks clarification when `guests` is required | `test/deterministic-model.test.mjs` |
| Missing room identifier is invented | deterministic + LLM tool planning require grounded identifier/reference | `test/webchat.test.mjs`, `test/llm-model.test.mjs` |
| Model output carries unknown tool arguments | schema property allowlist + executor revalidation | `test/llm-model.test.mjs` |
| Model output malformed / provider unavailable | bounded deterministic fallback, no permission relaxation | `test/llm-model.test.mjs`, `test/model-telemetry.test.mjs` |
| Model timeout causes retry storm / duplicate inference cost | 8s default deadline; `maxRetries=0`; deterministic fallback | `test/workers-ai-provider.test.mjs` |
| LLM response invents operational facts | operational facts rendered deterministically from tool result; LLM may only choose bounded style/CTA enum | `test/model-responder.test.mjs`, `test/model-telemetry.test.mjs` |
| Tool-result/prompt data leaks trusted routing metadata into memory | tool-result memory recursively redacts tenant/hotel/actor/guest/trace/session/execution metadata | `test/conversation-context.test.mjs` |
| Conversation supplied by client overrides server memory | conversation store is server-owned and bounded | `test/conversation-context.test.mjs` |
| Reservation self-approves | Policy Engine ignores model/user approval claims; only trusted channel metadata can approve | `test/reservation-control.test.mjs` |
| Approval executes a different probabilistic reroute | exact validated canonical plan stored in single-use challenge; `/api/approve` executes stored plan without re-calling model | `test/reservation-control.test.mjs` |
| Approved plan changes guest identity after approval | canonical trusted identity is included before operation fingerprint and revalidated at execution | `test/hms-agent-identity.test.mjs`, `test/trusted-guest-identity.test.mjs` |
| Approval challenge replay / message or key substitution | challenge bound to session/tenant/actor/message/idempotency and single-use | `test/reservation-control.test.mjs` |
| Side effect without idempotency | executor requires trusted idempotency key | `test/idempotency.test.mjs`, `test/reservation-control.test.mjs` |
| Same idempotency key different payload | conflict | `test/idempotency.test.mjs` |
| Cross-tenant idempotency collision | tenant-namespaced key | `test/idempotency.test.mjs` |
| Cancel arbitrary booking | cancellation requires trusted session ownership binding and original create token | `test/reservation-control.test.mjs` |
| Provider/model cost is invisible | inference telemetry records model/tokens/latency/estimated cost/log ID; fallback reason separately recorded | `test/model-telemetry.test.mjs`, `test/workers-ai-provider.test.mjs` |

## 2.6.1 corpus interpretation

The frozen fixture remains unchanged. The implementation-specific interpretation of `CLR-002` guest identity is recorded separately in `.orchestration/evidence/ACP-2.6.1-CORPUS-INTERPRETATION.md`: guest identity is a trusted session/application precondition, not an HMS UUID the user or model may choose.

## Provider / cost boundary

Default staging model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
Pricing verified 2026-08-30 against Cloudflare public documentation and isolated in the provider adapter:

- input: USD 0.293 / million tokens;
- output: USD 2.253 / million tokens.

AI Gateway logging is enabled for the synthetic staging experiment to provide provider-side observability. **This does not approve production prompt/PII logging.** Production identity, privacy, log retention and consent remain outside 2.6.

## Known bounded limitations — not hidden

1. A timed-out Workers AI request cannot be assumed cancelled remotely. Runtime falls back after the deadline, but provider-side cost for the abandoned request may still exist; AI Gateway is the authoritative provider-side evidence.
2. Current design performs a second small inference for bounded response style/CTA. Its value versus latency/cost must be measured in 2.6.8. It is not assumed optimal.
3. Synthetic `visitor-demo -> guestId` mapping is staging-only and not a production identity system.
4. Natural correctness of the real model is not claimed by unit tests. The >=90% conversational threshold must be exercised against the real Workers AI model in 2.6.8 before Product Acceptance.

## QA verdict

`PASS` for automated/adversarial implementation QA.

This verdict is **not** `PRODUCT_ACCEPTANCE`, **not** `PRODUCTION_ELIGIBLE`, and does not unblock Alquileres. The next method step is Pre-Critic / Independent Critic on immutable Artifact A.
