# ACP 2.6.9-R2.8.4 — Integration Checkpoint

Date: `2026-09-02`

This integration-only checkpoint exists to force a fresh exact-head `core-ci` and fresh PR review on a new branch after PR #60 reused the historical PR #58 head branch and GitHub associated stale pull-request checks.

Functional code head remains `404d4f091860109d35d66176c0f6059f670b8ba9`.
Documentation/evidence head before this checkpoint is `aee8bfb007c2b858fb368b308d57eb7a69cd67b3`.

The functional gate is already proven by two consecutive exact-head real-model GREEN attempts on run `33641836819`, and the documentary head `aee8bfb0...` also passed the R2.8.4 real-model staging workflow `33643297279`.

This checkpoint changes no runtime behavior, authority, tool contract, policy, HITL, idempotency, ownership, HMS adapter, provider selection or staging corpus.

R2.8.5 remains blocked until the fresh integration PR is clean, merged, post-merge main CI passes, and canonical state converges.
