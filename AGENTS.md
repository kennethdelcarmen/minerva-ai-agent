# AGENTS.md

This repository is reserved for an AI browser agent that takes a plain-English goal and autonomously works through a browser while keeping the operator informed and in control.

The current repository is intentionally empty except for Git metadata. This file defines the engineering contract that future implementation work must follow.

## Product Goal

Build a browser agent with these baseline properties:

- It accepts a natural-language goal from a user.
- It plans and executes multi-step browser work as an actual agent, not a hardcoded site script.
- It makes its work visible through live actions, page-state updates, and legible operator-facing status.
- It keeps a human in control with pause, stop, intervene, and approval controls.
- It handles retries, replans, and failures explicitly.
- It ends with a clean, structured, reviewable result.

## Core Stack

Lock these defaults unless a future decision is documented and approved:

- `browser-use` is the agent runtime and orchestration layer.
- `Playwright` is the browser automation layer.
- Python is the default backend runtime for the agent loop.
- A separate frontend/backend architecture is allowed, but this repository does not require that split to be scaffolded yet.

Assumptions behind this stack choice:

- `browser-use` refers to the current Python-first open-source project/runtime, not a custom internal wrapper.
- Playwright remains the underlying browser engine used with `browser-use`, not a replacement for it.

## Repository Expectations

When the repository is scaffolded, keep responsibilities clearly separated:

- Browser control code
- Agent orchestration and policy code
- Operator UI
- Shared contracts, schemas, or event types

General engineering rules for this repo:

- Prefer small, reversible changes with observable behavior.
- Do not present brittle hardcoded site scripts as autonomous agent behavior.
- Preserve operator trust over raw automation speed.
- Keep behavior explicit enough that a maintainer can trace why the agent acted.

## Agent Behavior Standards

Any implementation in this repository must satisfy these behavior standards:

- Stream the agent's actions as they happen.
- Show current page state live through screenshots or an equivalent browser-state view.
- Surface a legible action log and operator-facing rationale summaries.
- Support stop, pause, resume, and direct human intervention.
- Surface retries, replans, blocked states, and terminal failures explicitly.
- Never hide irreversible actions behind silent automation.

## Safety And Approval Policy

Default action policy:

- Safe read-only and navigation steps may auto-run.
- Form submission, checkout continuation, downloads, authentication, and destructive actions require human review by default.
- Final payment, purchase confirmation, or other irreversible commit actions must be blocked unless future scope explicitly changes that policy.

If an action cannot be classified confidently, treat it as review-required.

## Implementation Guardrails

Prefer early versions that are public, testable, and demonstrably end to end.

Future implementations should preserve a structured event model that can represent at least:

- `plan`
- `action`
- `observation`
- `approval`
- `error`
- `result`

Persist run artifacts needed for debugging and operator trust where feasible:

- screenshots
- action log
- browser trace

## Verification Expectations

Every meaningful browser-agent feature should include verification for:

- A happy-path end-to-end run
- Human interruption or approval handling
- A stuck or recovery scenario
- Final-result validation

Browser-facing changes should be validated against a real site or a controlled browser fixture, not only unit tests.

Do not claim a browser workflow works unless it has been exercised in a browser.

## Known Environment Constraints

The following constraints are already known from local inspection and primary documentation:

- Local Node is `v24.18.0`, which is compatible with modern Playwright's documented Node 24.x support.
- Local npm is `11.16.0`.
- Local Python is `3.9.6`.
- The current `browser-use` project documentation states `Python>=3.11`.

Python must therefore be upgraded before browser-use-based implementation starts in this repository.

## Definition Of Done For Future Agent Work

Agent work in this repository is not done unless:

- A goal is accepted and tracked through execution.
- Actions are visible live.
- A human can steer or stop the run.
- Failures are explicit and legible.
- The final result is structured and reviewable.

## Scope Of This Initialization

This initialization step is documentation-only.

- No project scaffolding has been created.
- No dependencies have been installed.
- No application code has been added.
