# OpenCode GPT-5.6 Model Routing

This file is a runtime adapter policy. It does not change Project Method, Task Contracts, gates, invariants, DICS authority, or product scope.

## Provider

Use the native `openai` provider authenticated through OpenCode with `ChatGPT Plus/Pro` OAuth when available. Do not require OpenCode Zen for this routing and never commit credentials. If the OpenAI provider is unavailable, report a runtime/model blocker instead of silently changing project semantics or swapping to an unapproved provider.

## Routing principle

Use the cheapest model tier that is adequate for the task. Escalate because of demonstrated complexity/risk, not because a command or test failed once.

### LOW — GPT-5.6 Luna
Use for:
- project orchestration and handoffs;
- repository/state recovery;
- mechanical or repetitive edits with a fully specified transformation;
- fixture/data migrations where expected semantics are already defined;
- formatting, renames, bookkeeping and evidence collection;
- deterministic test execution and simple failure classification.

Do not use LOW to invent architecture, reinterpret an ambiguous contract, weaken invariants, or make a novel safety-critical decision.

### MEDIUM — GPT-5.6 Terra
Use for:
- normal implementation under a stable architecture/Task Contract;
- multi-file changes with known responsibilities;
- non-trivial debugging where the abstraction is still believed correct;
- Engineering QA;
- integration/evidence review;
- substantive but bounded design reasoning.

### HIGH — GPT-5.6 Sol
Use only when the expected value justifies the higher tier:
- repeated same-family findings or root-cause/architecture review;
- cross-cutting responsibility changes;
- security/safety-critical mutation paths;
- Independent Critic on a final candidate artifact;
- unresolved contradictions between contract, implementation and evidence;
- exceptional complexity where Terra is insufficient.

## Agent mapping

- `project-controller` -> Luna
- `engineering-routine` -> Luna
- `engineering` -> Terra
- `engineering-qa` -> Terra
- `root-cause-architect` -> Sol
- `independent-critic` -> Sol
- `integration-review` -> Terra

## Escalation rules

1. Start with the role appropriate to the work, not the strongest model.
2. Routine work that becomes semantically ambiguous must stop and return to the Controller; do not improvise a design decision.
3. A single mechanical CI/tool failure does not justify Sol.
4. Repeated findings in the same causal family require `root-cause-architect`, not more case-by-case repairs.
5. The implementing context never counts as Independent Critic, regardless of model tier.
6. Model identity never grants authority to change scope, consume a Human Gate, weaken a contract, or declare closure.
7. If a configured GPT-5.6 model/provider is unavailable, report a runtime/model blocker rather than silently changing project semantics to fit another model.

## Cost-control intent

The purpose of this routing is to spend most routine work on Luna, normal engineering/review work on Terra, and reserve Sol for infrequent high-value reasoning and final criticism. Step limits are role-specific so repetitive work cannot silently turn into an unbounded high-cost session.
