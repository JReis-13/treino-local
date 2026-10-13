import type { ImportedTraining } from "@/types/training";
import type { SourceSnapshot } from "@/lib/import/snapshot";

export function usableImport(imported: ImportedTraining) {
  return imported.workouts.length > 0 && imported.workouts.every((workout) => workout.blocks.length > 0 &&
    workout.blocks.every((block) => block.kind === "exercise" ? Boolean(block.name.trim()) : Boolean(block.heading.trim() || block.text.trim()))) &&
    !imported.warnings.some((warning) => warning.severity === "activationBlocker");
}
export function assertUsableImport(imported: ImportedTraining) {
  if (!usableImport(imported))
    throw new Error("Training cannot be activated: no complete usable workout was identified. Review the workbook layout and import notes; existing plans and History are unchanged.");
}

export function layoutGuidance(snapshot: SourceSnapshot) {
  const safeHeaders = new Set(["exercise", "exercises", "exercícios", "exercicio", "exercicios", "reps", "repetições", "repeticoes", "sets", "load", "carga", "carga atual", "equipment", "equipamento", "vídeo referência", "video", "date", "data"]);
  const detected = [...new Set(snapshot.sheets.flatMap((sheet) => Object.values(sheet.cells)
    .filter((cell) => Number(cell.ref.match(/\d+/)?.[0]) <= 25 && safeHeaders.has(cell.displayed.trim().toLowerCase()))
    .map((cell) => cell.displayed.trim())))].slice(0, 8);
  return "Use a supported training workbook with TREINO tabs, PLANO DE TREINO at C1 and DIAS DE TREINO at E4. Strength layouts need AQUECIMENTO at E18, FORÇA at E24 and EQUIPAMENTO / VÍDEO headers at I25/J25 or J25/K25. " +
    (detected.length ? `Recognized headers: ${detected.join(" · ")}. ` : "No recognized training headers found. ") +
    "Use the supported template supplied with your training plan, or request a compatible workbook. Renaming headers alone does not convert an incompatible layout.";
}
