# Agent Test Execution Policy

## Goal
Reduce wasted development time by avoiding long, repeated test runs during implementation.

## Rules
- Do not run independent test commands during normal implementation work.
- Only run tests when one of these conditions is true:
  - The user explicitly asks to run tests.
  - The agent is in final verification right before commit or push.
  - A commit/push hook triggers the checks.
- Prefer lightweight validation during development (for example, syntax checks or focused lint) when needed.

## Examples
- Forbidden during coding loop: `npm test`, `pytest`, `go test ./...` without user request.
- Allowed near integration step: run project test suite once as part of pre-commit/pre-push verification.

