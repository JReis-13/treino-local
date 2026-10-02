import { spawnSync } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const revision = process.env.VERCEL_GIT_COMMIT_SHA || spawnSync("git", ["rev-parse", "--short=8", "HEAD"],
  { cwd: root, encoding: "utf8", windowsHide: true }).stdout?.trim() || "local";
const builtAt = new Date().toISOString();
const buildId = `${revision.slice(0, 8)}-${builtAt.replace(/[-:.]/g, "").slice(0, 15)}`;
const environment = { ...process.env, NEXT_PUBLIC_TREINO_BUILD_ID: buildId, NEXT_PUBLIC_TREINO_BUILT_AT: builtAt };

await copyFile(join(root, "google-apps-script", "WorkoutConnector.gs"), join(root, "public", "WorkoutConnector.gs.txt"));
const next = spawnSync(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "build"],
  { cwd: root, env: environment, stdio: "inherit", windowsHide: true });
if (next.status !== 0) process.exit(next.status ?? 1);
const worker = spawnSync(process.execPath, [join(root, "scripts", "generate-sw.mjs")],
  { cwd: root, env: environment, stdio: "inherit", windowsHide: true });
if (worker.status !== 0) process.exit(worker.status ?? 1);
