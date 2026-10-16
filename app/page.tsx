"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app-provider";
import { formatLocalDate } from "@/lib/dates";
import { activePlan } from "@/lib/training/session";
import type { TrainingWorkout } from "@/types/training";
import { SocialHomeCard } from "@/components/social-home-card";
import { planSessionCount, sourceOccurrenceAudit } from "@/lib/training/counts";

export default function HomePage() {
  const router = useRouter();
  const { data, error, start } = useApp();
  if (!data) return <div className="loading">Loading your training…</div>;
  const plan = activePlan(data);
  if (!plan) return <div className="page-stack home-page"><section className="hero"><p className="eyebrow">YOUR TRAINING STARTS HERE</p><h1>Choose your<br /><em>training.</em></h1><p>Import once. Your workouts and progress stay on this device for everyday use.</p></section>
    {error && <div className="alert" role="alert">{error}</div>}
    <SocialHomeCard />
    <div className="source-choice"><Link className="source-choice-card" href="/plans/?source=google"><strong>Connect Google Sheet</strong><span>Connect your Google account, then paste each training Sheet URL.</span><b>Continue →</b></Link><Link className="source-choice-card" href="/plans/?source=excel"><strong>Import Excel file</strong><span>Choose an .xlsx workbook from this device.</span><b>Continue →</b></Link></div></div>;
  const own = data.sessions.filter((session) => session.planId === plan.id && session.status === "completed");
  const completedSessions = planSessionCount(data, plan.id);
  const sourceOccurrences = sourceOccurrenceAudit(data, plan);
  const legacy = sourceOccurrences.filter((item) => item.status === "source record");
  const sourceNeedsReview = sourceOccurrences.filter((item) =>
    (!item.includedInHome && !item.reviewed) || item.reason === "RECONCILIATION_CONFLICT").length;
  const latest = [...own].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
  const inProgress = data.sessions.find((session) => session.planId === plan.id && session.status === "inProgress");

  function begin(workout: TrainingWorkout) {
    if (inProgress && inProgress.workoutId !== workout.id) { router.push(`/workout/?id=${encodeURIComponent(workout.id)}`); return; }
    const session = start(plan!.id, workout.id);
    if (session) router.push(`/workout/?id=${encodeURIComponent(session.workoutId)}`);
  }
  function workoutTile(workout: TrainingWorkout, index: number) {
    return <article className={`workout-tile ${index % 2 ? "tile-b" : "tile-a"}`} key={workout.id}>
      <div className="tile-top"><span className="tile-label">{workout.title}</span><span className="tile-index">{String(index + 1).padStart(2, "0")}</span></div>
      <div><h3>{workout.id}</h3><p>{workout.description}</p><div className="tile-meta"><span>◷ {workout.duration || "Flexible"}</span><span>{workout.blocks.filter((block) => block.kind === "exercise").length || workout.blocks.length} {workout.blocks.some((block) => block.kind === "exercise") ? "exercises" : "instruction blocks"}</span></div></div>
      <button type="button" className="tile-button" onClick={() => begin(workout)}>{inProgress ? inProgress.workoutId === workout.id ? `Resume ${workout.title}` : `View ${workout.title}` : "Start workout"}<span aria-hidden="true">↗</span></button>
    </article>;
  }

  return <div className="page-stack home-page">
    <section className="hero current-training-hero"><p className="eyebrow">CURRENT TRAINING</p><h1>{plan.name}</h1><p>Your workout plan is ready on this device, even offline.</p><div className="hero-stat"><strong>{completedSessions}</strong><span>completed<br />sessions</span></div>{plan.source.kind === "google" && <p className="hero-source-count">{sourceOccurrences.length} current Sheet record{sourceOccurrences.length === 1 ? "" : "s"}</p>}{sourceNeedsReview > 0 && <Link className="hero-source-review" href="/history/#source-review">{sourceNeedsReview} source record{sourceNeedsReview === 1 ? "" : "s"} need{sourceNeedsReview === 1 ? "s" : ""} review · Review →</Link>}<Link className="hero-manage-link" href="/plans/">Switch training / manage plans →</Link></section>
    <SocialHomeCard compact />
    {error && <div className="alert" role="alert">{error}</div>}
    {inProgress && <Link className="resume-banner" href={`/workout/?id=${encodeURIComponent(inProgress.workoutId)}`}><span><strong>{inProgress.workoutSnapshot.title} in progress</strong><small>Pick up where you left off</small></span><span aria-hidden="true">→</span></Link>}
    <div className="section-heading"><div><p className="eyebrow">YOUR PROGRAM</p><h2>Choose a workout</h2></div><span className="section-count">{plan.workouts.length} WORKOUT TYPES</span></div>
    <div className="workout-grid">{plan.workouts.map(workoutTile)}</div>
    <div className="overview-grid"><Link className="mini-panel" href="/history/"><span className="mini-icon">◷</span><span className="mini-label">HISTORY</span><strong>{latest ? latest.workoutSnapshot.title : legacy.length ? "Imported workouts" : "No sessions yet"}</strong><small>{latest?.localDate ? formatLocalDate(latest.localDate) : `${legacy.length} source dates`}</small></Link></div>
  </div>;
}
