import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fixturePath } from "./fixture-path";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { addTraining } from "../lib/training/library";
import { emptyTrainingData, parseTrainingData } from "../lib/training/storage";
import { startTrainingSession } from "../lib/training/session";

for (const filename of ["TREINO 1 JONATHA.xlsx", "TREINO 4 MILENA.xlsx"]) {
  let path: string | undefined;
  try { path = fixturePath(filename); } catch { /* Optional private fixture is unavailable. */ }
  test(`private source-to-workout load audit: ${filename}`, { skip: !path }, async () => {
    assert(path);
    const before = new Uint8Array(await readFile(path));
    const beforeHash = createHash("sha256").update(before).digest("hex");
    const snapshot = await snapshotFromXlsx(before);
    const imported = parseTrainingSnapshot(snapshot,
      { kind: "excel", filename, template: "", mappings: {}, mode: "copy" }, "private");
    const variant = imported.source.kind === "excel" ? imported.source.template : "unknown";
    const data = parseTrainingData(JSON.stringify(addTraining(emptyTrainingData(), imported, undefined,
      "2026-10-08T08:00:00Z", "audit")));
    let audited = 0, loaded = 0, blank = 0, grouped = 0;
    const internalRecords: Array<{ sheet: string; row: number; cell?: string; index: number;
      raw?: string; format?: string; parsed?: string; stored?: string; initial?: string }> = [];
    for (const workout of imported.workouts) {
      const sourceSheet = snapshot.sheets.find((item) => item.name === `TREINO ${workout.id}`);
      if (!sourceSheet) continue;
      const storedWorkout = data.plans[0].workouts.find((item) => item.id === workout.id)!;
      const session = startTrainingSession(data, "audit", workout.id, new Date("2026-10-08T09:00:00Z"), `audit-${workout.id}`).session;
      for (const row of [26, 28, 30, 32, 33]) {
        const group = workout.blocks.filter((block) => block.kind === "exercise" && block.sourceCell === `E${row}`);
        if (group.length > 1) grouped++;
        group.forEach((block, index) => {
          if (block.kind !== "exercise") return;
          const sourceCell = block.loadSource ? sourceSheet.cells[block.loadSource.cell] : undefined;
          const stored = storedWorkout.blocks.find((item) => item.id === block.id);
          const initial = session.blocks.find((item) => item.blockId === block.id)?.actualLoad;
          assert(stored?.kind === "exercise");
          assert.equal(stored.defaultLoad, block.defaultLoad);
          assert.equal(initial, block.defaultLoad);
          let expected: string | undefined;
          if (variant === "jonatha-v1") {
            const text = sourceSheet.cells[`H${row}`]?.displayed.trim();
            const parts = text?.split("/");
            if (parts?.length === group.length) expected = parts[index].trim() === "?" ? undefined : parts[index].trim();
            assert.equal(block.loadSource?.part, parts?.length === group.length ? index : undefined);
          } else if (sourceCell) expected = sourceCell.displayed.trim() || undefined;
          assert.equal(block.defaultLoad, expected?.replace(/^([+-]?\d+),(\d+)$/, "$1.$2"));
          internalRecords.push({ sheet: sourceSheet.name, row, cell: block.loadSource?.cell, index,
            raw: sourceCell?.raw, format: sourceCell?.numberFormat, parsed: block.defaultLoad,
            stored: stored.defaultLoad, initial });
          audited++;
          if (block.defaultLoad === undefined) blank++; else loaded++;
        });
      }
    }
    assert(audited > 0 && loaded > 0 && blank > 0 && grouped > 0 && internalRecords.length === audited);
    const afterHash = createHash("sha256").update(await readFile(path)).digest("hex");
    assert.equal(afterHash, beforeHash, "Canonical private workbook changed during read-only audit.");
  });
}
