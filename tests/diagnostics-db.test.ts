import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { reportCode, storeDiagnosticReport } from "../lib/support/server";

test("isolated support DB upload sanitizes, expires, bounds retention and resolves exact CLI code", async (t) => {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL) return t.skip("DATABASE_URL unavailable");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: "require", connect_timeout: 8 });
  const [schema] = await sql`select to_regclass('treino_support.diagnostic_reports') is not null as exists`;
  if (!schema.exists) { await sql.end({ timeout: 2 }); return t.skip("Migration 004 has not been applied"); }
  const id = randomUUID(), marker = `codex-diagnostic-${randomUUID()}`;
  try {
    await sql`insert into treino_social.users (id, google_sub, email, display_name)
      values (${id}, ${marker}, ${`${marker}@example.invalid`}, 'Diagnostic test')`;
    const source = { debugReportVersion: 1, timestamp: "2026-10-08T08:00:00Z",
      app: { buildId: "1234abcd-20261008T080000", online: true },
      source: { latestSessionSync: "synced", historicalPendingSessions: 2 },
      push: { supported: true, endpoint: "PRIVATE_ENDPOINT" },
      note: "PRIVATE_NOTE", load: "PRIVATE_LOAD" };
    const first = await storeDiagnosticReport(id, source);
    assert.match(first, /^TL-[A-HJ-NP-Z2-9]{8}$/);
    const [saved] = await sql`select report, expires_at, created_at from treino_support.diagnostic_reports
      where report_code = ${first} and user_id = ${id}`;
    assert(saved);
    assert(Math.abs((new Date(saved.expires_at).getTime() - new Date(saved.created_at).getTime()) / 86400000 - 14) < 0.01);
    const json = JSON.stringify(saved.report);
    for (const secret of ["PRIVATE_ENDPOINT", "PRIVATE_NOTE", "PRIVATE_LOAD", marker]) assert(!json.includes(secret));
    const cli = spawnSync(process.execPath, ["scripts/diagnostics-get.mjs", first],
      { encoding: "utf8", env: process.env });
    assert.equal(cli.status, 0);
    assert.equal(JSON.parse(cli.stdout).debugReportVersion, 1);
    assert(!cli.stdout.includes(process.env.DATABASE_URL!));
    const missing = spawnSync(process.execPath, ["scripts/diagnostics-get.mjs", "TL-ABCDEFGH"],
      { encoding: "utf8", env: process.env });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /not found or expired/);
    const expiredCode = reportCode();
    await sql`insert into treino_support.diagnostic_reports
      (id, report_code, user_id, debug_report_version, report, expires_at)
      values (${randomUUID()}, ${expiredCode}, ${id}, 1, '{}'::jsonb, now() - interval '1 day')`;
    for (let index = 0; index < 21; index++) await storeDiagnosticReport(id, source);
    const [count] = await sql`select count(*)::int as total from treino_support.diagnostic_reports where user_id = ${id}`;
    assert.equal(count.total, 20);
    const [expired] = await sql`select count(*)::int as total from treino_support.diagnostic_reports
      where user_id = ${id} and report_code = ${expiredCode}`;
    assert.equal(expired.total, 0);
  } finally {
    await sql`delete from treino_social.users where id = ${id} and google_sub = ${marker}`;
    await sql.end({ timeout: 2 });
  }
});
