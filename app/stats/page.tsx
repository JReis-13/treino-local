"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/components/app-provider";
import { filteredEntries, loadProgression, statsOverview, type StatsRange } from "@/lib/training/statistics";
import { durationMinutes, formatLocalDate } from "@/lib/dates";

function Trend({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <p className="quiet-note">A trend appears after two recorded values.</p>;
  const low = Math.min(...values), high = Math.max(...values), spread = Math.max(1, high - low);
  const points = values.map((value, index) => `${12 + index * 276 / (values.length - 1)},${102 - (value - low) / spread * 82}`).join(" ");
  return <svg className="stats-trend" viewBox="0 0 300 116" role="img" aria-label={label}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function StatsPage() {
  const { data } = useApp();
  const [planId, setPlanId] = useState("active");
  const [workoutId, setWorkoutId] = useState("all");
  const [range, setRange] = useState<StatsRange>("3m");
  const [exerciseId, setExerciseId] = useState("");
  const selectedPlan = planId === "active" ? data?.activePlanId ?? "all" : planId;
  const entries = useMemo(() => data ? filteredEntries(data, selectedPlan, workoutId, range) : [], [data, selectedPlan, workoutId, range]);
  if (!data) return <div className="loading">Loading statistics…</div>;
  const overview = statsOverview(entries, range);
  const workouts = [...new Map(data.plans.filter((plan) => selectedPlan === "all" || plan.id === selectedPlan)
    .flatMap((plan) => plan.workouts.map((workout) => [workout.id, workout.title] as const))).entries()];
  const exercises = [...new Map(entries.flatMap((entry) => entry.session?.workoutSnapshot.blocks.filter((block) => block.kind === "exercise")
    .map((block) => [`${entry.planId}|${block.id}`, `${block.name}${selectedPlan === "all" ? ` · ${data.plans.find((plan) => plan.id === entry.planId)?.name ?? "Removed plan"}` : ""}`] as const) ?? [])).entries()];
  const chosenExercise = exercises.some(([id]) => id === exerciseId) ? exerciseId : exercises[0]?.[0];
  const [exercisePlanId, exerciseBlockId] = chosenExercise?.split("|") ?? [];
  const progression = chosenExercise ? loadProgression(entries.filter((entry) => entry.planId === exercisePlanId), exerciseBlockId) : { points: [], mixedUnits: false };
  const firstLoad = progression.points[0]?.amount;
  const latestLoad = progression.points.at(-1)?.amount;
  const loadChange = firstLoad !== undefined && latestLoad !== undefined ? Math.round((latestLoad - firstLoad) * 10) / 10 : undefined;
  const percentChange = firstLoad && loadChange !== undefined ? Math.round(loadChange / firstLoad * 100) : undefined;
  const durations = entries.flatMap((entry) => entry.session ? [durationMinutes(entry.session.startedAt, entry.session.completedAt)] : [])
    .filter((value): value is number => value !== null).reverse();
  const distribution = workouts.map(([id, label]) => ({ id, label, count: entries.filter((entry) => entry.workoutId === id).length })).filter((item) => item.count);
  return <div className="page-stack stats-page"><div className="page-heading"><p className="eyebrow">LOCAL RECORDS</p><h1>Statistics<span className="dot-accent">.</span></h1><p>Your recorded workouts on this device.</p></div>
    <div className="stats-filters"><label className="date-field"><span>PLAN</span><select value={planId} onChange={(event) => { setPlanId(event.target.value); setWorkoutId("all"); setExerciseId(""); }}><option value="active">Current plan</option><option value="all">All plans</option>{data.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label><label className="date-field"><span>RANGE</span><select value={range} onChange={(event) => setRange(event.target.value as StatsRange)}><option value="4w">4 weeks</option><option value="3m">3 months</option><option value="6m">6 months</option><option value="all">All time</option></select></label></div>
    <div className="stats-metrics"><div className="mini-panel"><small>WORKOUTS</small><strong>{overview.workouts}</strong></div><div className="mini-panel"><small>AVG DURATION</small><strong>{overview.averageDuration ?? "—"}{overview.averageDuration !== null ? " min" : ""}</strong></div><div className="mini-panel"><small>PER WEEK</small><strong>{overview.perWeek}</strong></div></div>
    <p className="quiet-note stats-context">{overview.durationSample} timed session{overview.durationSample === 1 ? "" : "s"} · {overview.exercisesCompleted} exercise block{overview.exercisesCompleted === 1 ? "" : "s"} completed. Imported dates have no duration or load.</p>
    <details className="stats-more-filter"><summary>{workoutId === "all" ? "All workouts" : workouts.find(([id]) => id === workoutId)?.[1] ?? "Workout"} · change filter</summary><label className="date-field"><span>WORKOUT</span><select value={workoutId} onChange={(event) => { setWorkoutId(event.target.value); setExerciseId(""); }}><option value="all">All workouts</option>{workouts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></details>
    <section className="review-card"><h2>Workout duration</h2><p className="quiet-note">{overview.durationSample ? `${overview.durationSample} timed sessions${overview.shortest !== null ? ` · ${overview.shortest}–${overview.longest} min` : ""}` : "No recorded duration in this period."}</p>{overview.durationSample > 0 && <Trend values={durations} label="Workout duration trend in minutes" />}</section>
    <section className="review-card"><h2>Load progression</h2>{exercises.length ? <><label className="date-field"><span>EXERCISE</span><select value={chosenExercise} onChange={(event) => setExerciseId(event.target.value)}>{exercises.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>{progression.mixedUnits ? <p className="quiet-note">Recorded units differ; no numeric trend is shown.</p> : progression.points.length ? <><Trend values={progression.points.map((point) => point.amount)} label="Recorded load progression" /><div className="load-summary-grid"><div><small>FIRST</small><strong>{progression.points[0].amount}{progression.points[0].unit}</strong></div><div><small>LATEST</small><strong>{progression.points.at(-1)!.amount}{progression.points[0].unit}</strong></div><div><small>HIGHEST</small><strong>{Math.max(...progression.points.map((point) => point.amount))}{progression.points[0].unit}</strong></div></div>{progression.points.length > 1 && loadChange !== undefined && <p className="quiet-note">Recorded change: {loadChange >= 0 ? "+" : ""}{loadChange}{progression.points[0].unit}{percentChange !== undefined ? ` (${percentChange >= 0 ? "+" : ""}${percentChange}%)` : ""}.</p>}<div className="stats-points">{progression.points.slice(-5).reverse().map((point, index) => <span key={`${point.completedAt}-${index}`}>{formatLocalDate(point.date)} · {point.amount}{point.unit}</span>)}</div></> : <p className="quiet-note">No comparable numeric loads recorded for this exercise.</p>}</> : <p className="quiet-note">Complete a workout with a load to see progression.</p>}</section>
    <section className="review-card"><h2>Workout mix</h2>{distribution.length ? distribution.map((item) => <div className="stats-distribution" key={item.id}><span>{item.label}</span><strong>{item.count}</strong></div>) : <p className="quiet-note">No workouts in this period.</p>}</section>
  </div>;
}
