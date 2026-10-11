import type { ImportedTraining, ImportWarning } from "@/types/training";

// Presentation only: never infer a load assignment or change parser warnings.
export function warningExercises(imported: ImportedTraining, warning: ImportWarning) {
  const location = /^(.*)!(?:[A-Z]+)?([1-9]\d*)(?::[A-Z]+[1-9]\d*)?$/.exec(warning.location);
  if (!location || imported.source.kind === "builtin") return [];
  const source = imported.source;
  return imported.workouts.flatMap((workout) => source.mappings[workout.id]?.sheetName === location[1] ?
    workout.blocks.flatMap((block) => block.kind === "exercise" &&
      /^[A-Z]+([1-9]\d*)$/.exec(block.sourceCell ?? "")?.[1] === location[2] ? [{ workout, block }] : []) : []);
}
