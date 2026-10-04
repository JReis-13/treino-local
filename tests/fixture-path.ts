import { existsSync } from "node:fs";
import { join } from "node:path";

export function fixturePath(filename: string): string {
  const privateDirectory = join(process.cwd(), "tests", "fixtures", "private");
  const directory = process.env.WORKBOOK_FIXTURE_DIR || (existsSync(join(privateDirectory, filename)) ? privateDirectory :
    (process.env.USERPROFILE && join(process.env.USERPROFILE, "Downloads")));
  if (!directory) throw new Error("Set WORKBOOK_FIXTURE_DIR to a local directory containing the two private workbook fixtures.");
  const path = join(directory, filename);
  if (!existsSync(path)) throw new Error(`Missing local workbook fixture ${filename}. Set WORKBOOK_FIXTURE_DIR; never commit the workbook.`);
  return path;
}

// Legacy mapping tests deliberately use the original reviewed, blank-date workbook.
// The canonical private fixture may contain the user's later completion dates.
export function reviewedJonathaPath(): string {
  const path = process.env.WORKBOOK_REVIEWED_FIXTURE || (process.env.USERPROFILE &&
    join(process.env.USERPROFILE, "Downloads", "TREINO 1 JONATHA.xlsx"));
  if (!path || !existsSync(path)) throw new Error("Set WORKBOOK_REVIEWED_FIXTURE to the reviewed blank-date workbook.");
  return path;
}
