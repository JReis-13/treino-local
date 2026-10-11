import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const safeEnv = { ...process.env, DATABASE_URL: "postgres://production-must-not-be-used.invalid/db" };
delete safeEnv.TEST_DATABASE_URL;
delete safeEnv.TREINO_TEST_DATABASE;
function run(script, args = [], env = safeEnv) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env, windowsHide: true });
}
test("four routes resolve real documentation, source paths, tests and browser seeds", () => {
  for (const topic of ["history", "ui", "push", "release"]) {
    const result = run("scripts/workflow.mjs", [topic, "--plan"]);
    assert.equal(result.status, 0, result.stderr);
    for (const line of result.stdout.split(/\r?\n/).filter((line) => /^(docs|lib|components|app|scripts|playwright)[/\.]/.test(line)))
      assert(existsSync(line), line);
    const files = [...result.stdout.matchAll(/--file ([\w.-]+)/g)].map((match) => match[1]);
    if (files.length) assert.equal(run("scripts/run-tests.mjs", ["--list", ...files.flatMap((file) => ["--file", file])]).status, 0);
    for (const match of result.stdout.matchAll(/e2e\/[\w.-]+\.spec\.ts/g)) assert(existsSync(match[0]));
  }
});
test("typos, traversal and database opt-in without an isolated target fail before execution", () => {
  for (const args of [["--wat"], ["--file", "../push.test.ts"], ["--file", "missing.test.ts"],
    ["--file", "import.test.ts"], ["--database"], ["--require-private"]])
    assert.notEqual(run("scripts/run-tests.mjs", args).status, 0);
  assert.notEqual(run("scripts/workflow.mjs", ["release", "--run"]).status, 0);
  assert.notEqual(run("scripts/workflow.mjs", ["unknown"]).status, 0);
  assert.notEqual(run("scripts/social-integration.mjs").status, 0);
});
test("absent private fixtures are optional locally but a strict release gate fails", async () => {
  const folder = await mkdtemp(join(tmpdir(), "treino-fixtures-"));
  try {
    const env = { ...safeEnv, WORKBOOK_FIXTURE_DIR: folder };
    const optional = run("scripts/run-tests.mjs", ["--private-only"], env);
    assert.equal(optional.status, 0);
    assert.match(optional.stdout, /NOT RUN/);
    assert.equal(run("scripts/run-tests.mjs", ["--private-only", "--require-private"], env).status, 1);
    assert.equal(run("scripts/run-tests.mjs", ["--private"], env).status, 1, "all-tests mode must not silently skip public coverage");
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test("default database tests skip even with a production DATABASE_URL present", () => {
  const result = run("scripts/run-tests.mjs", ["--file", "push.test.ts", "--file", "diagnostics-db.test.ts", "--summary"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /skipped 2/);
  assert(!result.stdout.includes(safeEnv.DATABASE_URL));
});
test("concurrent unit runs own and remove only their temporary directories", async () => {
  const before = new Set(existsSync(".test-build") ? await readdir(".test-build") : []);
  const execute = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/run-tests.mjs", "--file", "session.test.ts", "--summary"],
      { env: safeEnv, windowsHide: true, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("exit", (code) => { try { assert.equal(code, 0, output); resolve(); } catch (error) { reject(error); } });
  });
  await Promise.all([execute(), execute()]);
  assert.deepEqual(new Set(await readdir(".test-build")), before);
});
test("summary mode preserves a failing test's message and nonzero exit", async () => {
  const name = `workflow-failure-${randomUUID()}.test.ts`;
  const path = join("tests", name);
  try {
    await writeFile(path, 'import test from "node:test"; test("intentional runner failure", () => { throw new Error("failure evidence retained"); });', { flag: "wx" });
    const result = run("scripts/run-tests.mjs", ["--file", name, "--summary"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /failure evidence retained/);
    assert.match(result.stdout, /fail 1/);
  } finally { await rm(path, { force: true }); }
});
