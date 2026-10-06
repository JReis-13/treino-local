import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const folder = resolve(".test-build");
if (!folder.startsWith(resolve(process.cwd()) + sep)) throw new Error("Unsafe temporary test path.");
try {
  const entries = (await readdir("tests")).filter((name) => name.endsWith(".test.ts") &&
    (!process.argv.includes("--excel") || name === "excel.test.ts"));
  await build({ entryPoints: entries.map((name) => resolve("tests", name)), outdir: ".test-build", bundle: true,
    absWorkingDir: process.cwd(), tsconfig: "./tsconfig.json", platform: "node", format: "cjs", target: "node24", outExtension: { ".js": ".cjs" }, logLevel: "warning" });
  const outputs = entries.map((name) => join(folder, name.replace(/\.ts$/, ".cjs")));
  const result = spawnSync(process.execPath, ["--test", ...outputs], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(folder, { recursive: true, force: true });
}
