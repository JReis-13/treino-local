import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL: missing"); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: "require", connect_timeout: 8, idle_timeout: 2 });
const expected = ["users", "friendships", "workout_activities", "activity_reactions", "schema_migrations"];
async function check() {
  await sql`select 1`;
  console.log("Database connection: OK");
  const [schema] = await sql`select to_regnamespace('treino_social') is not null as exists`;
  if (!schema.exists) { console.log("Social schema: missing"); return false; }
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'treino_social'`;
  const found = new Set(tables.map((row) => row.table_name));
  if (!expected.every((name) => found.has(name))) { console.log("Social schema: incomplete"); return false; }
  console.log("Social schema: OK");
  const [access] = await sql`select has_schema_privilege('anon', 'treino_social', 'USAGE') as anon,
    has_schema_privilege('authenticated', 'treino_social', 'USAGE') as authenticated`;
  if (access.anon || access.authenticated) { console.log("Social schema browser access: unsafe"); return false; }
  console.log("Social schema browser access: denied");
  const migration = await sql`select version from treino_social.schema_migrations where version = '001_social_v1'`;
  console.log(`Migration 001: ${migration.length ? "applied" : "missing"}`);
  return migration.length > 0;
}
async function migrate() {
  const [schema] = await sql`select to_regnamespace('treino_social') is not null as exists`;
  if (schema.exists) {
    const [table] = await sql`select to_regclass('treino_social.schema_migrations') is not null as exists`;
    if (table.exists) {
      const applied = await sql`select version from treino_social.schema_migrations where version = '001_social_v1'`;
      if (applied.length) { console.log("Migration 001: already applied"); return; }
    }
  }
  const migration = readFileSync("db/migrations/001_social_v1.sql", "utf8");
  await sql.unsafe(migration);
  console.log("Migration 001: applied");
}
async function smoke() {
  if (!await check()) throw new Error("Schema is unavailable.");
  const a = randomUUID(), b = randomUUID(), f = randomUUID(), activity = randomUUID(), reaction = randomUUID();
  const mark = `codex-smoke-${randomUUID()}`;
  try {
    await sql`insert into treino_social.users (id, google_sub, email, display_name, sharing_enabled)
      values (${a}, ${`${mark}-a`}, ${`${mark}-a@example.invalid`}, 'Smoke A', true),
             (${b}, ${`${mark}-b`}, ${`${mark}-b@example.invalid`}, 'Smoke B', true)`;
    await sql`insert into treino_social.friendships (id, requester_user_id, addressee_user_id, status)
      values (${f}, ${a}, ${b}, 'accepted')`;
    await sql`insert into treino_social.workout_activities
      (id, user_id, client_session_id, workout_name, completed_at, local_date)
      values (${activity}, ${a}, ${mark}, 'Smoke workout', now(), current_date)`;
    await sql`insert into treino_social.activity_reactions (id, activity_id, user_id, emoji)
      values (${reaction}, ${activity}, ${b}, '🔥')`;
    const rows = await sql`select r.emoji from treino_social.activity_reactions r
      join treino_social.workout_activities a on a.id = r.activity_id
      join treino_social.friendships f on f.requester_user_id = a.user_id and f.addressee_user_id = r.user_id
      where r.id = ${reaction} and f.status = 'accepted'`;
    if (rows.length !== 1 || rows[0].emoji !== "🔥") throw new Error("Smoke readback failed.");
    console.log("Social smoke: OK");
  } finally {
    await sql`delete from treino_social.users where id in (${a}, ${b}) and google_sub like ${`${mark}%`}`;
    console.log("Social smoke cleanup: OK");
  }
}
try {
  if (process.argv[2] === "migrate") { await migrate(); if (!await check()) process.exitCode = 1; }
  else if (process.argv[2] === "check") { if (!await check()) process.exitCode = 1; }
  else if (process.argv[2] === "smoke") await smoke();
  else throw new Error("Use migrate, check or smoke.");
} catch (cause) {
  console.error(`Database command failed${cause?.code ? ` (${cause.code})` : ""}. No connection details printed.`);
  process.exitCode = 1;
} finally { await sql.end({ timeout: 2 }); }
