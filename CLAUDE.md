@AGENTS.md

## Notes for Claude Code

In this project you usually plan or review; Codex usually implements. AGENTS.md describes the roles.

- Always start sessions from the repository root, so `.claude/settings.json` applies.
- When planning: read the code the feature touches and the existing pattern it should follow (for ledger providers, the Stripe adapter). Write the plan so the implementer makes no design decisions: every file, every new class and method signature, every test case with its expected result. Write the plan only, no production code.
- When reviewing: start from the plan and `git diff`, not from memory of the planning session.
