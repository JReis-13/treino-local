import { normalizeLoad, resolveLoadHistory } from "@/lib/training/loads";
import { planLineageKey, workoutLineageKey } from "@/lib/training/identity";
import type { ExerciseBlock, TrainingData } from "@/types/training";
const safeMappingCodes = new Set(["uncertain-load", "formatted-load", "load-formula-no-cache",
  "prescription-count", "shared-prescription", "equipment-count", "shared-equipment", "missing-video", "extra-video",
  "unclassified-row", "workout-content"]);
function normalizedDiagnosticLoad(value: string): string {
  const normalized = normalizeLoad(value.replace(/\s*kg\s*$/i, ""));
  return /^[+-]?\d+(?:\.\d+)?$/.test(normalized) ? String(Number(normalized)) : normalized.trim().toLocaleLowerCase("en-US");
}

/** Created only while collecting one report. This map is never saved or logged. */
function reportPseudonyms() {
  const assigned = new Map<string, string>();
  const used = new Set<string>();
  return (kind: "LOAD" | "PLAN" | "WORKOUT" | "EXERCISE", value: string | undefined): string | null => {
    if (!value?.trim()) return null;
    const key = `${kind}:${value}`;
    const existing = assigned.get(key);
    if (existing) return existing;
    let token: string;
    do {
      const bytes = new Uint8Array(10);
      globalThis.crypto.getRandomValues(bytes);
      token = `${kind}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    } while (used.has(token));
    used.add(token);
    assigned.set(key, token);
    return token;
  };
}

function location(exercise: ExerciseBlock): { row: number | null; column: number | null; groupIndex: number | null;
  loadRow: number | null; loadColumn: number | null } {
  const source = /^([A-Z]{1,2})(\d{1,3})$/.exec(exercise.sourceCell ?? "");
  const load = /^([A-Z]{1,2})(\d{1,3})$/.exec(exercise.loadSource?.cell ?? "");
  const column = (letters: string | undefined) => letters ? [...letters].reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0) : null;
  const group = /-(\d+)$/.exec(exercise.id);
  return { row: source ? Number(source[2]) : null, column: column(source?.[1]),
    groupIndex: group && exercise.groupId ? Number(group[1]) - 1 : exercise.groupId ? null : 0,
    loadRow: load ? Number(load[2]) : null, loadColumn: column(load?.[1]) };
}

export function buildLoadTrace(data: TrainingData | null) {
  const pseudonym = reportPseudonyms();
  const rows: Record<string, unknown>[] = [];
  const plans = data?.plans.slice(0, 4) ?? [];
  for (const plan of plans) {
    for (const workout of plan.workouts.slice(0, 8)) {
      const active = data?.sessions.find((session) => session.status === "inProgress" && session.planId === plan.id &&
        (session.workoutLineageKey ?? session.workoutId) === workoutLineageKey(workout));
      for (const exercise of workout.blocks) {
        if (exercise.kind !== "exercise") continue;
        if (rows.length >= 120) return { traceVersion: 1, truncated: true, rows };
        const historical = data ? resolveLoadHistory(data, plan.id, workout, exercise) : { matches: [], reason: "NO_HISTORY" };
        const last = historical.matches[0];
        const snapshot = active?.workoutSnapshot.blocks.find((block) => block.kind === "exercise" && block.id === exercise.id);
        const today = active?.blocks.find((block) => block.blockId === exercise.id);
        const sourceLoad = exercise.loadSource ? exercise.defaultLoad : undefined;
        const load = (value: string | undefined) => pseudonym("LOAD", value ? normalizedDiagnosticLoad(value) : undefined);
        const warningCodes = plan.importWarnings.filter((warning) => {
          const ref = /^([A-Z]{1,2})(\d{1,3})/.exec(warning.location.split("!").at(-1) ?? "");
          return ref && Number(ref[2]) === location(exercise).row;
        }).map((warning) => warning.code).filter((code) => safeMappingCodes.has(code)).slice(0, 8);
        rows.push({ plan: pseudonym("PLAN", plan.id), planLineage: pseudonym("PLAN", planLineageKey(plan)),
          workout: pseudonym("WORKOUT", `${plan.id}:${workout.id}`),
          workoutLineage: pseudonym("WORKOUT", `${planLineageKey(plan)}:${workoutLineageKey(workout)}`),
          exercise: pseudonym("EXERCISE", `${plan.id}:${workout.id}:${exercise.id}`),
          exerciseLineage: pseudonym("EXERCISE", `${planLineageKey(plan)}:${workoutLineageKey(workout)}:${exercise.sourceCell ?? exercise.id}:${location(exercise).groupIndex}`),
          ...location(exercise), template: plan.source.kind === "builtin" ? "builtin" : plan.source.template,
          parserVersion: 3, planVersion: plan.version, sourceLoad: load(sourceLoad), planLoad: load(exercise.defaultLoad),
          sessionLoad: snapshot?.kind === "exercise" ? load(snapshot.defaultLoad) : null,
          lastLoad: load(last?.load), todayLoad: load(today?.actualLoad),
          missing: { source: !sourceLoad?.trim(), plan: !exercise.defaultLoad?.trim(),
            session: !snapshot || snapshot.kind !== "exercise" || !snapshot.defaultLoad?.trim(),
            last: !last?.load, today: !today?.actualLoad?.trim() },
          todayOrigin: today?.loadOrigin ?? (today ? "UNKNOWN" : "NONE"),
          todayInitialOrigin: today?.initialLoadOrigin ?? (today?.loadOrigin === "USER" ? "USER" : today ? "UNKNOWN" : "NONE"),
          historyReason: historical.reason, identityMatch: Boolean(last), mappingCodes: [...new Set(warningCodes)] });
      }
    }
  }
  return { traceVersion: 1, truncated: false, rows };
}
