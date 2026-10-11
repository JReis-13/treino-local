# Development workflow

Start from root `AGENTS.md`, then `corepack pnpm workflow <history|ui|push|release> --plan`.
The router prints paths and seed commands; it does not preload documents or verify a release.
Use `--run` for a topic's unit seed. Expand tests according to the actual changed dependency graph.
For an unrelated task, use the map below rather than reading all audits and the original specification.

## Current subsystem map

| Area | Start here | Specialized reference |
| --- | --- | --- |
| Local state, plan versions, sessions | `components/app-provider.tsx`, `types/training.ts`, `lib/training/{storage,library,session}.ts` | README; `testing.md` |
| Source occurrences, receipts, count reconciliation | `lib/training/{identity,history-match,history-delete,counts}.ts` | `history-integrity-test-report.md` |
| Grouped exercise/load parsing, Excel writes | `lib/import/template-parser.ts`, `lib/excel/`, `lib/sync/` | `excel-adapter.md` |
| Google authorization and Sheets read/write | `lib/google/`, `app/api/google/` | `google-oauth-developer-setup.md` |
| Mobile workout, History, Friends UI | `app/`, `components/`, `app/globals.css`, matching `e2e/` specs | `mobile-ui-review.md`, `friends-navigation.md` |
| Private social summaries and retry/cache | `lib/social/`, `app/api/social/` | `social-v1.md` |
| Push device binding and worker delivery | `lib/push/`, `app/api/push/`, `scripts/generate-sw.mjs` | `push-notifications.md` |
| Privacy-safe diagnostic provenance | `lib/diagnostic*.ts`, `lib/support/server.ts`, `scripts/diagnostics-get.mjs` | `diagnostics.md` |
| PWA lifecycle and build identity | `lib/pwa/update-manager.ts`, `components/register-service-worker.tsx`, `scripts/build.mjs` | `testing.md`, `deployment.md` |

Paths in the reference column are relative to `docs/`. The original `workout-app-spec.md` and dated audits describe earlier decisions; verify them against current code. No new architecture layer replaces these subsystems.

## Investigation and handoff

1. Inspect Git status/diff and the closest route. Search bounded directories with `rg`; read the relevant functions and document sections once.
2. Record a concrete trigger, expected/observed behavior and evidence. Distinguish current phone/server/source evidence from synthetic reproductions and historical reports.
3. For History trace source read → parsed occurrences/identity → reconciliation → active/archive/tombstones → plan selector → UI. Compare every occurrence; preserve local session snapshots and same-day Add/Replace identity. Never infer a phone root cause from passing synthetic tests alone.
4. For UI select the corresponding browser spec and relevant installed Next guide. Check touch targets, overflow, navigation and hydration at affected widths. Emulation cannot establish physical-device PWA behavior.
5. For push trace capability/permission → cookie-bound subscription/device → account/preference → event claim → transport → service-worker receipt. Use safe trace IDs and diagnostics, not subscription endpoints, tokens or raw browser storage.
6. Run targeted verification while editing, then the applicable full gates in [testing](testing.md). Record PASS / FAIL / NOT RUN separately. Retest after new changes or unresolved failures, not merely to accumulate output.
7. Before handoff review diff and check status. Summarize changed paths, evidence, remaining uncertainty and commands actually executed. Keep any private evidence local and ignored; use synthetic regression fixtures in Git.

Default to one agent for coupled provider/identity changes or small UI fixes. When human authorization permits delegation, an independent read-only audit or isolated test investigation can help. Bound its files, output and acceptance criteria; request a compact findings summary. Shared edits, repeated repository bootstraps and multiple full suites usually add cost here. No standing agent roles or custom agent configuration are installed by this change.

## Why this structure

Audit on 2026-10-11 found only the generated Next rule in `AGENTS.md`, 18 documentation files with current procedures mixed with dated reports, no repository Skills/agent configuration and no CI workflow. Root `CLAUDE.md` already delegates to `AGENTS.md`; it remains unchanged. README/deployment described an obsolete absence of server databases despite optional private social/support storage.

Tests bundled all selected files into one shared `.test-build` directory, printed every passing test, and could not select exact files. Two unit files automatically loaded `.env.local` and wrote to its database; support retention cleanup is not limited to their synthetic rows. Integration testing also defaulted to that database. Generated browser/test artifacts were not lint exclusions, and local/deployed browser suites shared an output root.

The solution is a short always-loaded rule file, this on-demand map, reuse of specialized docs, a small deterministic router and safer existing test tools. Test runs own unique temporary directories, summaries preserve failures, explicit file selection rejects typos, missing private release fixtures fail, and database writes require a dedicated `TEST_DATABASE_URL`.

Rejected for now: overlapping repository Skills (the same four routes would need duplicate trigger metadata/instructions), agent role fleets, a new plugin/MCP, global Codex configuration changes, new dependencies and a new CI service. A future CI gate can reuse the offline commands when the owner chooses a runner; it must not require private fixtures or production credentials. Add a Skill only when a repeated, distinctive procedure needs reusable activation beyond this routing map.

## Verified environment and discovery

This desktop exposes file/shell tools, app tools and bounded collaboration tools; global skills are already advertised. The actual executable is `codex-cli 0.162.0-alpha.17.2`; Node is 24.21.0, pnpm 10.34.6. Read-only configuration inspection confirmed a trusted project and enabled bundled plugins; this task changes no user settings, model, approval policy or sandbox.

The separate shell CLI could print version/help but `features list` could not resolve its home in this managed sandbox. Therefore custom agent configuration/feature flags were not assumed verified. The desktop already supplied root instructions in this session. New instruction content takes effect in a fresh task; no claim of a nested Codex end-to-end invocation is made.

Official [instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md) supports root `AGENTS.md`. Official [Skill discovery](https://learn.chatgpt.com/docs/build-skills) supports `.agents/skills/<name>/SKILL.md`, with metadata loaded before task instructions. No repository Skill is needed initially. Future Skills belong there, not in an invented `.codex/agents` structure. Specialized docs and scripts activate through the root routing command, not automatic loading of the entire docs folder.

## Measuring efficiency

The router reports selection, and `--run` records wall time. `pnpm test --summary` reports test totals, skips and the byte size of full output before compaction; failures print complete output. These are execution/output observations, not token counts or controlled before/after speed claims.

For future comparable tasks, record revision, task type, changed paths, selected files, commands, wall time, tool calls, loaded file bytes and any task-level input/output tokens available from Codex. Account-wide usage percentages are not task measurements. Compare similar tasks under the same Node/dependencies/fixtures/network/browser conditions; include coordination and failed retries. Use normal task runs rather than expensive artificial benchmarks. Refine seeds when they miss changed dependencies; remove a route/Skill if maintenance and discovery overhead exceed its use.

Verification observations for this change (2026-10-11):

| Workflow | Unit selection | Result | Observed unit-seed wall time |
| --- | --- | --- | --- |
| History reconciliation | 4 of 35 files | 19 passed | 509 ms |
| Mobile UI | 3 of 35 files | 23 passed | 1,020 ms |
| Push investigation | 3 of 35 files | 7 passed, 1 DB check skipped | 1,989 ms |
| Full ordinary suite | 29 of 35 files | 130 passed, 2 DB checks skipped | Node reported 1,496 ms test duration; bundling/startup excluded |

These overlapping runs were verification, not a controlled benchmark. Full-suite detail was 12,758 UTF-8 bytes before summary filtering; no task token measurement is available. Workflow regression tests exercised route discovery, invalid input, strict fixture absence, production-URL rejection, simultaneous test-directory cleanup and failure visibility. Lint/typecheck passed; Playwright discovered 156 local and 6 deployed tests without executing browsers. Release plan discovery was verified; private source audits, database writes, a production build, browser execution, live push and physical-phone release checks were NOT RUN for this tooling/docs-only change. The sandbox initially blocked esbuild's parent-directory traversal; authorized execution outside that sandbox passed. A recursive Node-test environment warning during the first harness run led to explicitly clearing inherited `NODE_TEST_CONTEXT` before child test execution.
