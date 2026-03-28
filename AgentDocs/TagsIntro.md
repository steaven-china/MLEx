# Tags Introduction

## Purpose
Use tags as stable retrieval anchors so memory recall stays precise across long conversations.

## Current Workspace
- team: `{{team}}`
- service: `{{service}}`
- environment: `{{environment}}`
- owner: `{{owner}}`

## Tag Definitions
- `critical`: incidents, rollback risk, production-impacting decisions, urgent blockers.
- `normal`: routine progress updates, implementation notes, low-risk status changes.
- `ops`: deployment, infra, on-call, runbook, monitoring, and operational actions.
- `decision`: architecture/API/strategy decisions that should be traceable later.

## Tagging Rules
1. Prefer **one primary tag** per memory block.
2. Use `critical` only when user impact / availability / rollback risk is explicit.
3. Use `decision` when a non-trivial choice is made (with rationale).
4. If uncertain, fall back to `normal`.

## Retrieval Hints
- Prioritize `critical` and `decision` blocks for debugging and planning.
- When asked about releases or incidents, include `ops` context first.
