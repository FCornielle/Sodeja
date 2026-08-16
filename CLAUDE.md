# SODEJA — Claude Code Configuration

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- NEVER add a `Co-Authored-By` trailer to user commits unless this project's `.claude/settings.json` has `attribution.commit` set (#2078). The Claude Code Bash tool may suggest one in its default commit-message template — ignore it. `Co-Authored-By` is semantic authorship attribution under git/GitHub convention; the tool is the facilitator, not a co-author.
- Keep files under 500 lines
- Validate input at system boundaries

## Agents — one specialist per feature

Every backlog item gets implemented by spawning exactly **one** subagent —
never a multi-role team (`architect`+`coder`+`tester`+`reviewer` in parallel).
That pattern was in this file's boilerplate from `ruflo init` but was never
actually used across B-1 through B-17+, which were all implemented, tested,
and validated end-to-end by a single agent per item. One specialist per
feature keeps that discipline while still getting a prompt tailored to the
part of the codebase the feature actually touches.

Pick the specialist by which package/app owns the feature's primary scope:

| Domain | Agent | Owns |
|---|---|---|
| API / provider adapters / resilience | `sodeja-backend` | `apps/api`, `packages/providers`, `packages/observability` |
| Database / RLS / ingestion | `sodeja-data` | `packages/db`, `services/ingestion` |
| Financial calculations / business rules | `sodeja-calc` | `packages/calc`, `packages/rules` |
| Frontend / map UI | `sodeja-web` | `apps/web` |

Definitions live in `.claude/agents/sodeja/*.md`. Each one already encodes
this project's established conventions (DI-token adapters, `withTimeout`'s
`Promise.race` fix, RLS session helpers, Money currency guards, the
server-side-proxy posture, etc.) so it doesn't need to be re-derived from
scratch on every spawn.

Rules:

- Read the backlog item's scope/dependencies/acceptance criteria from
  `docs/SODEJA_MVP_BACKLOG.md` yourself first, then spawn the one matching
  specialist with that context — don't make the specialist re-discover the
  backlog on its own.
- If a feature genuinely spans two domains (rare — B-7a's gate touched
  several controllers), dispatch to specialists sequentially, one at a time,
  not in parallel — each waits for the prior one's result before starting.
- Reserve `fork`/`general-purpose` for things that aren't a backlog feature at
  all — an open-ended audit, a parallel research question — per this file's
  own earlier convention; those aren't "features" and don't need a SODEJA
  specialist.
- The old generic agent roster this repo shipped with (`byzantine-coordinator`,
  `raft-manager`, `gossip-coordinator`, SPARC phase agents, etc.) has been
  removed — none of it matched this project's actual stack, and several of
  those names were referenced in this file's old text without ever having a
  real definition backing them.

## Ruflo MCP (optional, currently unreliable)

The `ruflo` MCP server (`memory_store`, `swarm_init`, `hooks_route`, etc.) is
registered globally but frequently fails to connect. Don't rely on it or
route work through it by default. If it happens to be connected and a task
would genuinely benefit from its memory/swarm tools, discover them via
`ToolSearch` first — never assume they're loaded.

## Build & Test

- ALWAYS run the full validation suite after code changes:
  `pnpm turbo run lint typecheck test build`
- ALWAYS verify build succeeds before committing
