import type { Exercise, ExercisePrescription, WorkoutId, WorkoutPlan } from "@/types/workout";

type Entry = [name: string, raw: string, videoUrl: string, equipment?: string, defaultLoad?: string, note?: string];

function prescription(raw: string): ExercisePrescription {
  const normalized = raw.replaceAll(",", ".");
  const timed = /s(?:\/lado)?$/.test(normalized);
  const perSide = /\/lado$/.test(normalized);
  const steps = normalized.includes("passos");
  const setsMatch = normalized.match(/^(\d+)x(\d+)(?:-(\d+))?/);
  if (setsMatch) {
    return {
      sourceText: raw,
      sets: Number(setsMatch[1]),
      min: Number(setsMatch[2]),
      max: setsMatch[3] ? Number(setsMatch[3]) : undefined,
      unit: timed ? "seconds" : "reps",
      perSide,
    };
  }
  const count = Number(normalized.match(/^\d+/)?.[0]);
  if (!Number.isFinite(count)) throw new Error(`Unknown prescription: ${raw}`);
  return { sourceText: raw, min: count, unit: steps ? "steps" : "reps", perSide };
}

function makeExercises(id: WorkoutId, warmup: Entry[], strength: Entry[]): Exercise[] {
  return [...warmup, ...strength].map(([name, raw, videoUrl, equipment, defaultLoad, note], index) => ({
    id: `${id.toLowerCase()}-${index < 3 ? "warmup" : "strength"}-${index + 1}`,
    name,
    section: index < 3 ? "warmup" : "strength",
    order: index + 1,
    pairId: index < 3 ? undefined : `${id.toLowerCase()}-pair-${Math.floor((index - 3) / 2) + 1}`,
    prescription: prescription(raw),
    equipment,
    defaultLoad,
    videoUrl,
    note,
  }));
}

const rir = [2, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0];

export const WORKOUTS: Record<WorkoutId, WorkoutPlan> = {
  A: {
    id: "A", title: "Workout A", description: "Força + estabilidade", expectedMinutes: { min: 40, max: 45 },
    warmupMinutes: 5, betweenSetRestNote: "1–2 min entre séries; 2 min entre pares de força.",
    rirByOccurrence: rir, planVersion: "workbook-2026-09-12",
    exercises: makeExercises("A", [
      ["Mobilidade de quadril + rotação torácica", "8x/lado", "https://www.youtube.com/shorts/spjnmreGb7U"],
      ["Caminhada lateral com miniband", "10 passos/lado", "https://www.youtube.com/shorts/7saA5QnyJX8"],
      ["Dead bug", "8x/lado", "https://www.youtube.com/shorts/DqLL45uk2Tk"],
    ], [
      ["Agachamento goblet", "3x8-10", "https://www.youtube.com/shorts/jtlT3l7jD1M", "Halter", "8"],
      ["Remada baixa neutra", "3x10-12", "https://www.youtube.com/shorts/6ml0iz19DPw", "Polia", "15"],
      ["Levantamento terra romeno com halteres", "3x8-10", "https://www.youtube.com/shorts/oQwnGfZFfzw", "Hhalteres", "7.5", "Equipamento escrito 'Hhalteres' na planilha."],
      ["Face pull", "3x12-15", "https://www.youtube.com/shorts/IeOqdw9WI90", "Polia", "6"],
      ["Afundo reverso", "2x8-10/lado", "https://www.youtube.com/shorts/755boqDfMe4", "Halteres", "6"],
      ["Panturrilha em pé unilateral", "2x12-15/lado", "https://www.youtube.com/shorts/EOYf2Vau9_E", "Step, halter", undefined, "Carga '6/?' no par; esta carga é desconhecida."],
      ["Pallof press", "2x10-15/lado", "https://www.youtube.com/shorts/vgkJb94lK10", "Polia", "5", "Equipamento único na linha do par."],
      ["Rotação externa na polia", "2x12-15/lado", "https://www.youtube.com/shorts/goprHr4m6uk", "Polia", "2.5", "Equipamento único na linha do par."],
    ]),
  },
  B: {
    id: "B", title: "Workout B", description: "Força + prevenção para o vôlei", expectedMinutes: { min: 40, max: 45 },
    warmupMinutes: 5, betweenSetRestNote: "1–2 min entre séries; 2 min entre pares de força.",
    rirByOccurrence: rir, planVersion: "workbook-2026-09-12",
    exercises: makeExercises("B", [
      ["Bom dia sem carga", "10x", "https://www.youtube.com/shorts/6E6SeWHVP_0"],
      ["Perdigueiro", "10x/lado", "https://www.youtube.com/shorts/ieaIrJeRnZE"],
      ["Ponte unilateral", "8x/lado", "https://www.youtube.com/shorts/0e1SXFq806U"],
    ], [
      ["Hip thrust com barra", "3x8-10", "https://www.youtube.com/shorts/eN03zP5ICIs", "Banco, barra", undefined, "Prescrição única para o par na planilha."],
      ["Supino com halteres", "3x8-10", "https://www.youtube.com/shorts/ceq2KGuY9Ts", "Banco, halteres", undefined, "Prescrição compartilhada inferida de F26."],
      ["Step-up", "3x8/lado", "https://www.youtube.com/watch?v=KCu2QHbnIZE", "Step, halteres"],
      ["Puxada alta na polia", "3x10-12", "https://www.youtube.com/shorts/oF-RqXrkZHU", "Polia"],
      ["Mesa flexora", "2x10-12", "https://www.youtube.com/shorts/bA5gbGtltFs", "Máquina"],
      ["Elevação lateral com halteres", "2x12-15", "https://www.youtube.com/shorts/yURmeIEl1Fg", "Halteres"],
      ["Copenhagen plank", "2x20-30s/lado", "https://www.youtube.com/shorts/kXTHTV6--Bo", "Banco, colchonete", undefined, "Equipamento único na linha do par; atribuição não confirmada."],
      ["Tibial raise", "2x15-20", "https://www.youtube.com/shorts/Dd-8s86-zio", undefined, undefined, "Equipamento não indicado separadamente na planilha."],
    ]),
  },
};

export function isWorkoutId(value: string): value is WorkoutId {
  return value === "A" || value === "B";
}
