import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const folder = resolve(".test-build");
if (!folder.startsWith(resolve(process.cwd()) + sep)) throw new Error("Unsafe temporary test path.");
try {
  const privateFiles = new Set(["google-sheets.test.ts", "google-migration.test.ts", "import.test.ts",
    "private-load-audit.test.ts", "excel.test.ts", "source-sync.test.ts"]);
  const privateMode = process.argv.includes("--private-only") || process.argv.includes("--excel");
  const all = process.argv.includes("--private");
  const directories = process.env.WORKBOOK_FIXTURE_DIR ? [process.env.WORKBOOK_FIXTURE_DIR] :
    [resolve("tests", "fixtures", "private"), process.env.USERPROFILE && resolve(process.env.USERPROFILE, "Downloads")].filter(Boolean);
  if (privateMode && !["TREINO 1 JONATHA.xlsx", "TREINO 4 MILENA.xlsx"].every((name) =>
    directories.some((directory) => existsSync(resolve(directory, name))))) {
    console.log("Private workbook fixtures unavailable; optional workbook tests skipped.");
    process.exit(0);
  }
  const entries = (await readdir("tests")).filter((name) => name.endsWith(".test.ts") &&
    (process.argv.includes("--excel") ? name === "excel.test.ts" :
      privateMode ? privateFiles.has(name) : all || !privateFiles.has(name)));
  await build({ entryPoints: entries.map((name) => resolve("tests", name)), outdir: ".test-build", bundle: true,
    absWorkingDir: process.cwd(), tsconfig: "./tsconfig.json", platform: "node", format: "cjs", target: "node24", outExtension: { ".js": ".cjs" }, logLevel: "warning",
    plugins: [{ name: "server-only-in-node-tests", setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({ contents: "", loader: "js" }));
    } }] });
  const outputs = entries.map((name) => join(folder, name.replace(/\.ts$/, ".cjs")));
  const result = spawnSync(process.execPath, ["--test", ...outputs], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(folder, { recursive: true, force: true });
}
