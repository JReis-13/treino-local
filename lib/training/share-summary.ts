import { durationMinutes, isLocalDate } from "@/lib/dates";
import type { LegacyCompletion, TrainingSession } from "@/types/training";

/** The complete allowlist of workout data permitted in public share output. */
export interface WorkoutShareSummary {
  workoutName: string;
  localDate: string;
  durationMinutes?: number;
  completedExercises?: number;
  totalExercises?: number;
}

export function shareSummaryFromSession(session: TrainingSession): WorkoutShareSummary {
  if (session.status !== "completed" || !session.localDate || !isLocalDate(session.localDate)) {
    throw new Error("Only saved workouts with a valid local date can be shared.");
  }
  const exerciseIds = new Set(session.workoutSnapshot.blocks.filter((block) => block.kind === "exercise").map((block) => block.id));
  const recordedExercises = session.blocks.filter((block) => exerciseIds.has(block.blockId));
  const completedIds = new Set(recordedExercises.filter((block) => block.completed).map((block) => block.blockId));
  const minutes = durationMinutes(session.startedAt, session.completedAt);
  return {
    workoutName: session.workoutSnapshot.title,
    localDate: session.localDate,
    ...(minutes === null ? {} : { durationMinutes: minutes }),
    ...(recordedExercises.length ? { completedExercises: completedIds.size, totalExercises: exerciseIds.size } : {}),
  };
}

export function shareSummaryFromLegacy(legacy: LegacyCompletion, workoutName: string): WorkoutShareSummary {
  if (!isLocalDate(legacy.date)) throw new Error("This imported workout has no valid local date.");
  return { workoutName, localDate: legacy.date };
}

export function shareDate(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(day).padStart(2, "0")} ${months[month - 1]} ${year}`;
}

export function shareMetrics(summary: WorkoutShareSummary): string {
  const parts: string[] = [];
  if (summary.durationMinutes !== undefined) parts.push(summary.durationMinutes === 0 ? "under 1 min" : `${summary.durationMinutes} min`);
  if (summary.completedExercises !== undefined && summary.totalExercises !== undefined) {
    parts.push(`${summary.completedExercises}/${summary.totalExercises} exercises completed`);
  }
  return parts.join(" · ");
}

export function defaultShareText(summary: WorkoutShareSummary): string {
  return [`${summary.workoutName} completed 💪`, shareMetrics(summary), shareDate(summary.localDate)]
    .filter(Boolean).join("\n");
}
