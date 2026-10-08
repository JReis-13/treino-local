import { existsSync } from "node:fs";
import postgres from "postgres";

const code = process.argv[2];
if (!code || !/^TL-[A-HJ-NP-Z2-9]{8}$/.test(code) || process.argv.length !== 3) {
  console.error("Usage: pnpm diagnostics:get TL-XXXXXXXX");
  process.exit(2);
}
if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(2); }
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: "require", connect_timeout: 8, idle_timeout: 2 });
try {
  const rows = await sql`select report from treino_support.diagnostic_reports
    where report_code = ${code} and expires_at > now() limit 1`;
  if (!rows.length) { console.error("Diagnostic report not found or expired."); process.exitCode = 1; }
  else console.log(JSON.stringify(rows[0].report, null, 2));
} catch {
  console.error("Could not retrieve diagnostic report. No database details printed.");
  process.exitCode = 1;
} finally { await sql.end({ timeout: 2 }); }
