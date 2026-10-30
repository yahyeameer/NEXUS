# CLAUDE.md

@AGENTS.md

## Claude-specific notes

- Follow every rule in `AGENTS.md`; it is the source of truth for this repo.
- Use plan mode for any task touching `packages/sie` or `packages/voice` — these are the integrity-critical packages.
- When unsure whether something counts as a "claim" (and so must pass the SIE), treat it as a claim.
- Prefer editing existing files over creating new ones; check `docs/TASKS.md` for the current milestone before starting.
- After finishing a task, run the full check: `pnpm typecheck && pnpm lint && pnpm test && pnpm sie:redteam`.
