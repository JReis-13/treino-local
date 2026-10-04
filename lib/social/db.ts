import "server-only";
import postgres from "postgres";

let client: ReturnType<typeof postgres> | undefined;
export function socialDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Social database is not configured.");
  return client ??= postgres(url, { max: 1, prepare: false, ssl: "require", connect_timeout: 8, idle_timeout: 20 });
}
