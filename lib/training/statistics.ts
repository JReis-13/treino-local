import { durationMinutes, isLocalDate, localDateString } from "@/lib/dates";
import type { TrainingData, TrainingSession } from "@/types/training";
import { legacyIsHidden } from "@/lib/training/history-delete";
import { resolveLoadHistory, type LoadMatchReason } from "@/lib/training/loads";
import { matchingLocalSession } from "@/lib/training/history-match";

export type StatsRange = "4w" | "3m" | "6m" | "all";
export type StatsEntry = { id: string; planId: string; workoutId: string; date: string; session?: TrainingSession };

export function historyEntries(data: TrainingData): StatsEntry[] {
  const entries: StatsEntry[] = data.sessions.filter((session) => session.status === "completed" &&
    session.sourceReconciliation !== "removed" && isLocalDate(session.localDate ?? ""))
    .map((session) => ({ id: session.id, planId: session.planId, workoutId: session.workoutId,
      date: session.localDate!, session }));
  for (const plan of data.plans) for (const legacy of plan.legacyCompletions) {
    if (legacyIsHidden(data, plan.id, legacy)) continue;
    const matched = matchingLocalSession(data, plan, legacy);
    if (!matched) entries.push({ id: `${plan.id}:${legacy.id}`, planId: plan.id, workoutId: legacy.workoutId, date: legacy.date });
  }
  for (const archived of data.archivedSources ?? []) for (const legacy of archived.legacyCompletions) {
    if (legacyIsHidden(data, archived.planId, legacy)) continue;
    entries.push({ id: `${archived.planId}:${legacy.id}`, planId: archived.planId, workoutId: legacy.workoutId, date: legacy.date });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date) ||
    (b.session?.completedAt ?? "").localeCompare(a.session?.completedAt ?? ""));
}

export function startOfRange(range: StatsRange, today = localDateString()): string | undefined {
  if (range === "all") return undefined;
  const date = new Date(`${today}T12:00:00`);
  if (range === "4w") date.setDate(date.getDate() - 27);
  if (range === "3m") date.setMonth(date.getMonth() - 3);
  if (range === "6m") date.setMonth(date.getMonth() - 6);
  return localDateString(date);
}

export function filteredEntries(data: TrainingData, planId: string, workoutId: string, range: StatsRange,
  today = localDateString()): StatsEntry[] {
  const start = startOfRange(range, today);
  return historyEntries(data).filter((item) => (planId === "all" || item.planId === planId) &&
    (workoutId === "all" || (workoutId.includes("|") ? `${item.planId}|${item.workoutId}` === workoutId :
      item.workoutId === workoutId)) && (!start || item.date >= start) && item.date <= today);
}

export function statsOverview(entries: StatsEntry[], range: StatsRange, today = localDateString()) {
  const durations = entries.flatMap((item) => item.session ? [durationMinutes(item.session.startedAt, item.session.completedAt)] : [])
    .filter((value): value is number => value !== null);
  const totalDays = range === "all" ? Math.max(7, entries.length ?
    Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${entries[entries.length - 1].date}T12:00:00`)) / 86400000) + 1 : 7) :
    Math.max(1, Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${startOfRange(range, today)}T12:00:00`)) / 86400000) + 1);
  return { workouts: entries.length, averageDuration: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    durationSample: durations.length, shortest: durations.length ? Math.min(...durations) : null,
    longest: durations.length ? Math.max(...durations) : null,
    perWeek: Math.round(entries.length / (totalDays / 7) * 10) / 10,
    exercisesCompleted: entries.reduce((sum, item) => sum + (item.session?.blocks.filter((block) => block.completed).length ?? 0), 0) };
}

export function numericLoad(value: string): { amount: number; unit: string } | undefined {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(kg)?\s*$/i.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1].replace(",", "."));
  return Number.isFinite(amount) ? { amount, unit: (match[2] ?? "").toLowerCase() } : undefined;
}

export function loadProgression(entries: StatsEntry[], blockId: string, data?: TrainingData, planId?: string) {
  let historyReason: LoadMatchReason = "NO_HISTORY";
  let history: Array<{ sessionId: string; date: string; completedAt: string; load: string }>;
  if (data && planId) {
    const candidates = data.plans.find(plan => plan.id === planId)?.workouts.flatMap(workout =>
      workout.blocks.flatMap(block => block.kind === "exercise" && block.id === blockId ? [{ workout, block }] : [])) ?? [];
    const resolved = candidates.length === 1 ? resolveLoadHistory(data, planId, candidates[0].workout, candidates[0].block) :
      { matches: [], reason: "AMBIGUOUS_EXERCISE" as const };
    historyReason = resolved.reason;
    const visible = new Set(entries.map(entry => entry.session?.id));
    history = resolved.matches.filter(item => visible.has(item.session.id)).map(item => ({ sessionId: item.session.id,
      date: item.session.localDate!, completedAt: item.session.completedAt ?? "", load: item.load }));
    if (!history.length && resolved.matches.length) historyReason = "NO_HISTORY";
  } else history = entries.flatMap(entry => {
    const state = entry.session?.blocks.find(block => block.blockId === blockId && block.completed && block.actualLoad?.trim());
    return state?.actualLoad ? [{ sessionId: entry.session!.id, date: entry.date, completedAt: entry.session?.completedAt ?? "", load: state.actualLoad }] : [];
  });
  const points = history.flatMap(item => {
    const numeric = numericLoad(item.load);
    return numeric ? [{ date: item.date, completedAt: item.completedAt, ...numeric }] : [];
  }).sort((a,b) => a.date.localeCompare(b.date) || a.completedAt.localeCompare(b.completedAt));
  const units = new Set(points.map(point => point.unit));
  return { points: units.size <= 1 ? points : [], mixedUnits: units.size > 1, history, historyReason,
    nonNumericCount: history.filter(item => !numericLoad(item.load)).length };
}
