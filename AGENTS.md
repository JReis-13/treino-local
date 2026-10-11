<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Treino Local development

- Work in this existing repository. Inspect `git status` first; preserve unrelated changes. Node 24 / pnpm 10.34.6; use `corepack pnpm`.
- Start with `corepack pnpm workflow <history|ui|push|release> --plan` for the closest task. Read the selected sections, not every document. For other tasks use the subsystem map in `docs/development-workflow.md`. Treat dated audits/specifications as evidence, not current requirements.
- Preserve browser-local plans, session snapshots and History. Source sync saves locally first and requires mapped writes plus readback. Never rewrite History to match a refreshed plan. Preserve Google authorization, Supabase private schemas, explicit social/diagnostic consent and PWA update safeguards.
- Private workbooks are read-only fixtures. Never commit workbooks, private reports, browser state, credentials or raw loads/names in diagnostics. Tests must use synthetic data, disposable copies or an explicitly isolated test database; never the production database/Sheet.
- During development use the route's unit seed or `corepack pnpm test --summary --file NAME.test.ts`; broaden for changed dependencies. Targeted tests are not release verification. Follow `docs/testing.md` for full gates and report skipped/unavailable checks as NOT RUN.
- Default to one agent. Delegate only when authorized and independent work justifies the coordination cost; give bounded paths and acceptance criteria. Do not run competing builds/servers or overlapping edits.
- Before committing review the diff and run relevant checks. Commit/push/deploy only within the user's authorization; never force push. Pushing main triggers Vercel. Do not migrate databases or alter production data as part of routine verification.
