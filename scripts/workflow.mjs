import { spawnSync } from "node:child_process";

// One routing table: documentation is read on demand; tests are seeds, not a coverage boundary.
const routes = {
  history: {
    docs: ["docs/history-integrity-test-report.md", "docs/excel-adapter.md", "docs/diagnostics.md"],
    sources: ["lib/google/sheets.ts", "lib/import/template-parser.ts", "lib/training/library.ts", "lib/training/history-match.ts", "lib/training/counts.ts", "components/app-provider.tsx"],
    tests: ["google-history-reconcile.test.ts", "history-counts-and-receipts.test.ts", "history-delete.test.ts", "same-day-identity.test.ts"],
    browser: "e2e/history-diagnostics-finish.spec.ts",
  },
  ui: {
    docs: ["docs/mobile-ui-review.md", "docs/testing.md"],
    sources: ["app", "components", "app/globals.css"],
    tests: ["session.test.ts", "training-queue.test.ts", "exercise-context.test.ts"],
    browser: "e2e/mobile.spec.ts",
  },
  push: {
    docs: ["docs/push-notifications.md", "docs/social-v1.md", "docs/diagnostics.md"],
    sources: ["lib/push/client.ts", "lib/push/server.ts", "scripts/generate-sw.mjs", "app/api/push"],
    tests: ["push.test.ts", "push-worker.test.ts", "diagnostics-upload.test.ts"],
    browser: "e2e/push-settings.spec.ts",
  },
  release: {
    docs: ["docs/testing.md", "docs/deployment.md", "docs/production-deploy-checklist.md"],
    sources: ["scripts/build.mjs", "scripts/generate-sw.mjs", "playwright.config.ts", "playwright.deployed.config.ts"],
    commands: ["corepack pnpm install --frozen-lockfile", "corepack pnpm lint", "corepack pnpm typecheck",
      "corepack pnpm test --summary", "corepack pnpm test:workflow", "corepack pnpm test:workbooks:private --require-private --summary",
      "corepack pnpm build", "corepack pnpm start"],
  },
};
const [topic, ...args] = process.argv.slice(2);
if (!topic || topic === "--help") {
  console.log("pnpm workflow <history|ui|push|release> [--plan|--run]\nDefault: print a bounded task map. --run executes only a topic's unit seed; release is plan-only.");
} else {
  if (!Object.hasOwn(routes, topic) || args.some((arg) => !["--plan", "--run"].includes(arg)) || args.length > 1)
    throw new Error("Unknown workflow/options; use --help.");
  const route = routes[topic];
  console.log(`Workflow: ${topic}\nRead only relevant sections:\n${route.docs.join("\n")}\nStart tracing here:\n${route.sources.join("\n")}`);
  if (route.tests) {
    console.log(`Unit seed:\ncorepack pnpm test --summary ${route.tests.map((name) => `--file ${name}`).join(" ")}`);
    console.log(`Browser seed (running local server required):\ncorepack pnpm test:e2e ${route.browser}\nBroaden selection when the change crosses this route.`);
  } else {
    console.log(`Sequential local gates:\n${route.commands.join("\n")}\nThen, in another PowerShell terminal: $env:E2E_PRODUCTION='1'; corepack pnpm test:e2e\nDatabase integration, physical phone and deployed revision gates: see docs/testing.md.\nA plan is not evidence that any gate passed.`);
  }
  if (args.includes("--run")) {
    if (!route.tests) throw new Error("Release is plan-only: follow docs/testing.md and record each gate independently.");
    const started = performance.now();
    const result = spawnSync(process.execPath, ["scripts/run-tests.mjs", "--summary", ...route.tests.flatMap((name) => ["--file", name])],
      { stdio: "inherit", windowsHide: true });
    if (result.error) throw result.error;
    console.log(`Unit seed elapsed: ${Math.round(performance.now() - started)} ms. Database/browser/phone checks not executed.`);
    process.exitCode = result.status ?? 1;
  }
}
