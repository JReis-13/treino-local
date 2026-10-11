import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdir, rm, mkdir, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const flags = new Set(["--private-only", "--excel", "--private", "--require-private", "--list", "--summary", "--database", "--help"]);
const selected = [];
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--file") {
    const name = args[++index];
    if (!name || !/^[a-z0-9-]+\.test\.ts$/.test(name)) throw new Error("--file requires an exact test filename, without a path.");
    selected.push(name);
  } else if (!flags.has(args[index])) throw new Error(`Unknown test option: ${args[index]}`);
}
if (args.includes("--help")) {
  console.log("pnpm test [--file NAME.test.ts ...] [--list] [--summary]\nPrivate fixtures: --private-only | --excel | --private; --require-private fails if absent.\nDatabase writes: --database requires an explicitly isolated TEST_DATABASE_URL.");
  process.exit(0);
}
const privateFiles = new Set(["google-sheets.test.ts", "google-migration.test.ts", "import.test.ts",
  "private-load-audit.test.ts", "excel.test.ts", "source-sync.test.ts"]);
const privateMode = args.includes("--private-only") || args.includes("--excel");
const all = args.includes("--private");
if (args.includes("--require-private") && !privateMode && !all) throw new Error("--require-private needs a private fixture mode.");
const available = (await readdir("tests")).filter((name) => name.endsWith(".test.ts")).sort();
for (const name of selected) {
  if (!available.includes(name)) throw new Error(`Unknown test file: ${name}`);
  if (privateFiles.has(name) && !privateMode && !all) throw new Error("Private test selection requires --private or --private-only.");
}
const entries = available.filter((name) =>
  (args.includes("--excel") ? name === "excel.test.ts" : privateMode ? privateFiles.has(name) : all || !privateFiles.has(name)) &&
  (!selected.length || selected.includes(name)));
if (!entries.length) throw new Error("No tests selected.");
if (args.includes("--list")) { console.log(entries.join("\n")); process.exit(0); }
if (privateMode || all) {
  const directories = process.env.WORKBOOK_FIXTURE_DIR ? [process.env.WORKBOOK_FIXTURE_DIR] :
    [resolve("tests", "fixtures", "private"), process.env.USERPROFILE && resolve(process.env.USERPROFILE, "Downloads")].filter(Boolean);
  if (!["TREINO 1 JONATHA.xlsx", "TREINO 4 MILENA.xlsx"].every((name) =>
    directories.some((directory) => existsSync(resolve(directory, name))))) {
    console.log("Private workbook fixtures unavailable; workbook checks NOT RUN.");
    process.exit(args.includes("--require-private") || all ? 1 : 0);
  }
}
const environment = { ...process.env };
// A nested invocation starts a new test runner, not a child test-file process.
delete environment.NODE_TEST_CONTEXT;
delete environment.DATABASE_URL;
delete environment.TREINO_TEST_DATABASE;
if (args.includes("--database")) {
  if (!environment.TEST_DATABASE_URL) throw new Error("--database requires an isolated TEST_DATABASE_URL; production DATABASE_URL is never used.");
  environment.DATABASE_URL = environment.TEST_DATABASE_URL;
  environment.TREINO_TEST_DATABASE = "isolated";
}
const root = resolve(".test-build");
await mkdir(root, { recursive: true });
const folder = await mkdtemp(join(root, "run-"));
if (!folder.startsWith(root + sep)) throw new Error("Unsafe temporary test path.");
try {
  await build({ entryPoints: entries.map((name) => resolve("tests", name)), outdir: folder, bundle: true,
    absWorkingDir: process.cwd(), tsconfig: "./tsconfig.json", platform: "node", format: "cjs", target: "node24", outExtension: { ".js": ".cjs" }, logLevel: "warning",
    plugins: [{ name: "server-only-in-node-tests", setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({ contents: "", loader: "js" }));
    } }] });
  const outputs = entries.map((name) => join(folder, name.replace(/\.ts$/, ".cjs")));
  const summary = args.includes("--summary");
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...outputs],
    { stdio: summary ? "pipe" : "inherit", encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      windowsHide: true, env: { ...environment, NODE_DISABLE_COLORS: "1" } });
  if (result.error) throw result.error;
  if (summary) {
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    const compact = output.split(/\r?\n/).filter((line) => /^ℹ /.test(line)).join("\n");
    if (result.status !== 0) process.stdout.write(output);
    else {
      console.log(compact || output);
      if (compact && result.stderr) process.stderr.write(result.stderr);
    }
    console.log(`Selected ${entries.length}/${available.length} files; full test output ${Buffer.byteLength(output)} bytes.`);
  }
  process.exitCode = result.status ?? 1;
} finally {
  await rm(folder, { recursive: true, force: true });
}
