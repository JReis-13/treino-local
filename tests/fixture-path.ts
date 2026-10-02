import { existsSync } from "node:fs";
import { join } from "node:path";

export function fixturePath(filename: string): string {
  const directory = process.env.WORKBOOK_FIXTURE_DIR || (process.env.USERPROFILE && join(process.env.USERPROFILE, "Downloads"));
  if (!directory) throw new Error("Set WORKBOOK_FIXTURE_DIR to a local directory containing the two private workbook fixtures.");
  const path = join(directory, filename);
  if (!existsSync(path)) throw new Error(`Missing local workbook fixture ${filename}. Set WORKBOOK_FIXTURE_DIR; never commit the workbook.`);
  return path;
}
