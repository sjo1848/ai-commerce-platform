# ACP 2.6.1 — Frozen Corpus Interpretation Addendum

Status: `RECORDED — CORPUS NOT MODIFIED`
Date: 2026-08-30
Frozen corpus: `test/fixtures/acp-2.6-conversations.json` (`ACP-2.6.1-v1`)

## Why this addendum exists

The frozen corpus intentionally predates implementation. `CLR-002` says that a bare “Quiero reservar” must clarify `selection`, `dates`, and `guest`.

During implementation, review of the real HMS contract showed that asking a normal guest to provide an internal HMS `guestId` UUID would recreate a form/parser experience and expose an implementation identifier that should be application-owned.

The corpus is therefore **not rewritten**. Instead, the `guest` criterion is interpreted as an identity precondition:

- guest identity must be known or resolved by trusted application/session context before a reservation can execute;
- the LLM and user cannot choose `guestId`;
- ACP staging pins the synthetic actor `visitor-demo` to the synthetic HMS guest `12000000-0000-0000-0000-000000000001` in server-owned deployment configuration;
- that trusted `guestId` is injected before canonical validation and is included in the exact operation fingerprint used by HITL;
- a conflicting user/model `guestId` is rejected;
- if no trusted identity mapping exists, reservation validation fails closed rather than fabricating an identity.

## Acceptance consequence

For `CLR-002`, the assistant must still clarify the missing **room selection and dates**. It does not ask the guest to know or type an HMS UUID when trusted session identity already satisfies the `guest` precondition.

This is a narrowing of model/user authority, not an expansion of scope or a relaxation of the frozen safety threshold.

## Production boundary

The synthetic staging mapping is not a production identity design. Real customer identity onboarding, PII handling, retention and consent remain outside ACP 2.6 and require a later product/security gate before production use.
