"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app-provider";
import { formatLocalDate } from "@/lib/dates";
import { activePlan } from "@/lib/training/session";
import type { TrainingWorkout } from "@/types/training";

export default function HomePage() {
  const router = useRouter();
  const { data, error, start } = useApp();
  if (!data) return <div className="loading">Loading your training…</div>;
  const plan = activePlan(data);
  if (!plan) return <div className="page-stack home-page"><section className="hero"><p className="eyebrow">YOUR TRAINING STARTS HERE</p><h1>Choose your<br /><em>training.</em></h1><p>Import once. Your workouts and progress stay on this device for everyday use.</p></section>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="source-choice"><Link className="source-choice-card" href="/plans/?source=google"><strong>Connect Google Sheet</strong><span>Connect your Google account, then paste each training Sheet URL.</span><b>Continue →</b></Link><Link className="source-choice-card" href="/plans/?source=excel"><strong>Import Excel file</strong><span>Choose an .xlsx workbook from this device.</span><b>Continue →</b></Link></div></div>;
  const own = data.sessions.filter((session) => session.planId === plan.id && session.status === "completed");
  const legacy = plan.legacyCompletions.filter((entry) => !own.some((session) => session.workoutId === entry.workoutId && session.localDate === entry.date));
  const latest = [...own].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
  const inProgress = data.sessions.find((session) => session.planId === plan.id && session.status === "inProgress");
  const waiting = own.filter((session) => !["synced", "notApplicable"].includes(session.syncStatus)).length;

  function begin(workout: TrainingWorkout) {
    const session = start(plan!.id, workout.id);
    if (session) router.push(`/workout/?id=${encodeURIComponent(session.workoutId)}`);
  }

  return <div className="page-stack home-page">
    <section className="hero"><p className="eyebrow">CURRENT TRAINING</p><h1>{plan.name}</h1><p>Your workout plan is ready on this device, even offline.</p><div className="hero-stat"><strong>{own.length + legacy.length}</strong><span>workouts<br />recorded</span></div></section>
    {error && <div className="alert" role="alert">{error}</div>}
    <Link className="switch-link" href="/plans/">Switch training / manage plans →</Link>
    {inProgress && <Link className="resume-banner" href={`/workout/?id=${encodeURIComponent(inProgress.workoutId)}`}><span><strong>{inProgress.workoutSnapshot.title} in progress</strong><small>Pick up where you left off</small></span><span aria-hidden="true">→</span></Link>}
    <div className="section-heading"><div><p className="eyebrow">YOUR PROGRAM</p><h2>Choose a workout</h2></div><span className="section-count">{plan.workouts.length} WORKOUTS</span></div>
    <div className="workout-grid">{plan.workouts.map((workout, index) => <article className={`workout-tile ${index % 2 ? "tile-b" : "tile-a"}`} key={workout.id}>
      <div className="tile-top"><span className="tile-label">{workout.title}</span><span className="tile-index">{String(index + 1).padStart(2, "0")}</span></div>
      <div><h3>{workout.id}</h3><p>{workout.description}</p><div className="tile-meta"><span>◷ {workout.duration || "Flexible"}</span><span>{workout.blocks.filter((block) => block.kind === "exercise").length || workout.blocks.length} {workout.blocks.some((block) => block.kind === "exercise") ? "exercises" : "instruction blocks"}</span></div></div>
      <button type="button" className="tile-button" onClick={() => begin(workout)}>{inProgress ? "Open workout" : "Start workout"}<span aria-hidden="true">↗</span></button>
    </article>)}</div>
    <div className="overview-grid"><Link className="mini-panel" href="/history/"><span className="mini-icon">◷</span><span className="mini-label">HISTORY</span><strong>{latest ? latest.workoutSnapshot.title : legacy.length ? "Imported workouts" : "No sessions yet"}</strong><small>{latest?.localDate ? formatLocalDate(latest.localDate) : `${legacy.length} source dates`}</small></Link>
      <Link className="mini-panel" href="/source/"><span className="mini-icon">▦</span><span className="mini-label">SOURCE STATUS</span><strong>{plan.source.kind === "google" ? "Google Sheets" : plan.source.kind === "excel" ? "Excel file" : "Local plan"}</strong><small>{waiting} workout{waiting === 1 ? "" : "s"} waiting to sync</small></Link></div>
  </div>;
}
