"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { connectGoogle, googleStatus, importGoogleSheet, refreshGoogleSheet } from "@/lib/google/client";
import { removeConnectorKey } from "@/lib/connector/credentials";
import { loadFileHandle, removeFileHandle, saveFileHandle } from "@/lib/import/file-handles";
import { snapshotFromXlsx } from "@/lib/import/snapshot";
import { parseTrainingSnapshot } from "@/lib/import/template-parser";
import { describeChanges } from "@/lib/training/library";
import type { ImportedTraining, TrainingPlanRecord } from "@/types/training";

interface DirectHandle extends FileSystemFileHandle {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}
type PickerWindow = Window & { showOpenFilePicker?: (options: { types: Array<{ description: string; accept: Record<string, string[]> }>; multiple: boolean }) => Promise<DirectHandle[]> };
type Preview = { imported: ImportedTraining; targetId?: string; handle?: DirectHandle; migration?: boolean };

export default function PlansPage() {
  const router = useRouter();
  const { data, error, addPlan, refreshPlan, migrateGooglePlan, setActivePlan, renamePlan, removePlan } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [targetId, setTargetId] = useState<string | undefined>();
  const [migrationId, setMigrationId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [connected, setConnected] = useState(false);
  const [directAvailable, setDirectAvailable] = useState(false);
  const [stage, setStage] = useState<"library" | "choose" | "google" | "review">("library");

  useEffect(() => {
    setDirectAvailable(Boolean(window.isSecureContext && (window as PickerWindow).showOpenFilePicker));
    googleStatus().then((status) => setConnected(status.connected)).catch(() => setConnected(false));
    const result = new URLSearchParams(window.location.search).get("google");
    if (result) {
      setStage("google");
      setMessage(result === "connected" ? "Google connected. Paste a Google Sheets URL to import training." :
        result === "denied" ? "Google authorization was cancelled." :
        result === "unauthorized" ? "Esta conta Google não está autorizada a usar a integração Google do Treino Local." :
        "Google connection failed. Try again.");
      window.history.replaceState({}, "", "/plans");
    }
  }, []);
  useEffect(() => {
    if (!data || migrationId) return;
    const saved = sessionStorage.getItem("treino-google-migration-id");
    const plan = data.plans.find((item) => item.id === saved && item.source.kind === "google" && item.source.authMode !== "oauth");
    if (plan?.source.kind === "google") {
      setMigrationId(plan.id);
      setSheetUrl(plan.source.sheetUrl ?? (plan.source.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${plan.source.spreadsheetId}/edit` : ""));
    }
  }, [data, migrationId]);
  if (!data) return <div className="loading">Loading training plans…</div>;

  async function inspect(file: File, handle?: DirectHandle, refreshId?: string) {
    setBusy(true); setMessage("Reading training…");
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Choose an .xlsx workbook.");
      const snapshot = await snapshotFromXlsx(new Uint8Array(await file.arrayBuffer()));
      const imported = parseTrainingSnapshot(snapshot, { kind: "excel", filename: file.name, template: "", mappings: {}, mode: handle ? "direct" : "copy" }, file.name.replace(/\.xlsx$/i, ""));
      const matching = data?.plans.find((plan) => plan.source.kind === "excel" && plan.source.filename === file.name);
      const chosen = refreshId ?? matching?.id;
      setPreview({ imported, targetId: chosen, handle });
      setStage("review"); window.scrollTo(0, 0);
      setName(chosen ? data?.plans.find((plan) => plan.id === chosen)?.name ?? imported.name : imported.name);
      setMessage("Training imported. Review the summary before using it.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not read the workbook."); }
    finally { setBusy(false); }
  }
  async function selectExcel(refreshId?: string) {
    setTargetId(refreshId);
    if (directAvailable) {
      try {
        const [handle] = await (window as PickerWindow).showOpenFilePicker!({ types: [{ description: "Excel workbook", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }], multiple: false });
        if (handle) await inspect(await handle.getFile(), typeof handle.createWritable === "function" && typeof handle.queryPermission === "function" && typeof handle.requestPermission === "function" ? handle : undefined, refreshId);
      } catch (cause) { setMessage(cause instanceof DOMException && cause.name === "AbortError" ? "File selection cancelled." : cause instanceof Error ? cause.message : "Could not choose workbook."); }
    } else inputRef.current?.click();
  }
  async function refreshExcel(plan: TrainingPlanRecord) {
    try {
      const handle = await loadFileHandle(plan.id) as DirectHandle | undefined;
      if (handle) { await inspect(await handle.getFile(), handle, plan.id); return; }
      setMessage("Choose the updated workbook to refresh this training."); await selectExcel(plan.id);
    } catch { setMessage("File permission expired. Choose the workbook again."); await selectExcel(plan.id); }
  }
  async function importGoogle(refreshId?: string, sourceUrl = sheetUrl) {
    setBusy(true); setMessage("Reading spreadsheet…");
    try {
      const { imported } = await importGoogleSheet(sourceUrl);
      const spreadsheetId = imported.source.kind === "google" ? imported.source.spreadsheetId : undefined;
      const matching = data?.plans.find((plan) => plan.source.kind === "google" && plan.source.spreadsheetId === spreadsheetId);
      const chosen = refreshId ?? matching?.id;
      const old = data?.plans.find((plan) => plan.id === chosen);
      if (refreshId && old?.source.kind === "google" && old.source.spreadsheetId && old.source.spreadsheetId !== spreadsheetId) {
        throw new Error("This is a different spreadsheet. The original plan was left unchanged.");
      }
      const migration = Boolean(refreshId && old?.source.kind === "google" && old.source.authMode !== "oauth");
      setPreview({ imported, targetId: chosen, migration }); setName(old?.name ?? imported.name);
      setStage("review"); window.scrollTo(0, 0);
      setMessage(migration ? "Legacy plan matched. Review and reconnect without losing its local history." : "Training imported. Review it before using it.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not import Google Sheet."); }
    finally { setBusy(false); }
  }
  async function refreshGoogle(plan: TrainingPlanRecord) {
    if (plan.source.kind !== "google") return;
    if (plan.source.authMode === "oauth" && plan.source.spreadsheetId && plan.source.sourceProof && plan.sourceFingerprint) {
      setBusy(true); setMessage("Refreshing spreadsheet…");
      try { const { imported } = await refreshGoogleSheet(plan.source.spreadsheetId, plan.sourceFingerprint, plan.source.sourceProof);
        setPreview({ imported, targetId: plan.id }); setName(plan.name); setStage("review"); window.scrollTo(0, 0); setMessage("Updated training ready for review."); }
      catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not refresh spreadsheet."); }
      finally { setBusy(false); }
      return;
    }
    if (plan.source.authMode === "oauth" && plan.source.sheetUrl) { await importGoogle(plan.id, plan.source.sheetUrl); return; }
    sessionStorage.setItem("treino-google-migration-id", plan.id);
    setMigrationId(plan.id);
    setStage("google");
    setSheetUrl(plan.source.sheetUrl ?? (plan.source.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${plan.source.spreadsheetId}/edit` : ""));
    setMessage("This plan uses the legacy Google connector. Connect Google and paste the same Sheet URL to migrate it. Local workouts remain usable.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function commitPreview(updateTargetId?: string) {
    if (!preview || preview.imported.warnings.some((warning) => warning.severity === "activationBlocker")) return;
    setBusy(true);
    try {
      let planId: string | null;
      if (updateTargetId && preview.migration && preview.imported.source.kind === "google") {
        planId = migrateGooglePlan(updateTargetId, preview.imported) ? updateTargetId : null;
        if (planId) await removeConnectorKey(planId).catch(() => {});
      } else planId = updateTargetId ? (refreshPlan(updateTargetId, preview.imported) ? updateTargetId : null) : addPlan(preview.imported, name);
      if (!planId) throw new Error("The training could not be saved locally.");
      if (preview.handle) await saveFileHandle(planId, preview.handle).catch(() => setMessage("File handle could not be remembered. Reconnect when syncing."));
      setActivePlan(planId); setPreview(null); setMigrationId(undefined); sessionStorage.removeItem("treino-google-migration-id"); router.push("/");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not save training."); }
    finally { setBusy(false); }
  }
  async function remove(plan: TrainingPlanRecord) {
    if (!window.confirm(`Remove “${plan.name}” from this device? Completed local sessions stay in History.`)) return;
    if (removePlan(plan.id)) { await Promise.allSettled([removeFileHandle(plan.id), removeConnectorKey(plan.id)]); setMessage(`${plan.name} removed. Completed local sessions remain in History.`); }
  }
  const active = data.plans.find((plan) => plan.id === data.activePlanId);
  const activationBlocked = preview?.imported.warnings.some((warning) => warning.severity === "activationBlocker") ?? false;
  const syncBlocked = preview?.imported.warnings.some((warning) => warning.severity === "syncBlocker") ?? false;
  const notes = preview?.imported.warnings.filter((warning) => warning.severity !== "info") ?? [];
  return <div className={`page-stack plans-page stage-${stage}`}><div className="page-heading"><p className="eyebrow">TRAINING PLAN LIBRARY</p><h1>{stage === "library" ? "Training plans" : stage === "choose" ? "Add training" : stage === "google" ? "Google Sheet" : "Import review"}<span className="dot-accent">.</span></h1><p>{stage === "library" ? "Import once, switch any time. Your completed sessions stay with the plan used." : stage === "review" ? "Check the training before saving it on this device." : "Choose and import a training source."}</p></div>
    {stage !== "library" && <button type="button" className="inline-action" onClick={() => { setStage(stage === "review" ? "choose" : "library"); setPreview(null); setMessage(""); }}>← Back</button>}
    {(message || error) && <div className={error ? "alert" : "context-note"} role="status">{error ?? message}</div>}
    <section className="connection-card compact-google"><div><p className="eyebrow">GOOGLE SHEETS</p><strong>{connected ? "✓ Connected" : "Not connected"}</strong></div><button type="button" className="primary-button" onClick={() => { setStage("choose"); window.scrollTo(0, 0); }}>{connected ? "+ Add training" : "Connect or add training"}</button></section>
    <div className="source-choice"><div className="source-choice-card"><strong>Google Sheets</strong><span>Paste a Sheet URL you can access.</span><button type="button" className="primary-button" onClick={() => { setStage("google"); window.scrollTo(0, 0); }}>Use Google Sheets →</button></div><div className="source-choice-card"><strong>Excel file</strong><span>Choose a local .xlsx workbook.</span><button type="button" className="primary-button" disabled={busy} onClick={() => void selectExcel()}>Choose workbook →</button>{directAvailable && <button type="button" className="inline-action" disabled={busy} onClick={() => { setTargetId(undefined); inputRef.current?.click(); }}>Import as safe copy</button>}</div></div>
    <section className="connection-card connector-form"><p className="eyebrow">GOOGLE SHEETS</p><h2>{connected ? "Google account connected" : "Connect Google"}</h2>
      {!connected ? <button type="button" className="primary-button" onClick={() => connectGoogle("/plans")}>{message.includes("não está autorizada") ? "Tentar outra conta Google →" : "Connect Google →"}</button> : <>
        {migrationId && <p className="context-note">Reconnect legacy plan: {data.plans.find((plan) => plan.id === migrationId)?.name}. Use its original Sheet URL.</p>}
        <label className="date-field"><span>PASTE GOOGLE SHEETS LINK</span><input type="url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" autoComplete="url" /></label>
        <button type="button" className="primary-button" disabled={busy || !sheetUrl.trim()} onClick={() => void importGoogle(migrationId)}>{busy ? "Reading spreadsheet…" : migrationId ? "Reconnect this training →" : "Import training →"}</button>
      </>}
      <details className="review-warnings"><summary>How to add a training</summary><p>Tap Connect Google, choose your account, and allow access to Google Sheets. Open your training Sheet, copy its URL, paste it here, and tap Import training. For another training, paste another Sheet URL.</p></details>
    </section>
    <input ref={inputRef} className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file, undefined, targetId); else setMessage("File selection cancelled."); event.target.value = ""; }} />
    {preview && <section className="review-card"><p className="eyebrow">IMPORT REVIEW</p><h2>Training ready</h2><label className="date-field"><span>LOCAL TRAINING NAME</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><div className="review-stats"><span><strong>{preview.imported.workouts.length}</strong> workouts</span><span><strong>{preview.imported.workouts.flatMap((workout) => workout.blocks).filter((block) => block.kind === "exercise").length}</strong> exercises</span><span><strong>{preview.imported.workouts.flatMap((workout) => workout.blocks).filter((block) => block.kind === "instruction").length}</strong> instruction blocks</span><span><strong>{preview.imported.legacyCompletions.length}</strong> previous workouts</span></div>
      <p className="quiet-note">{preview.imported.workouts.map((workout) => workout.title).join(" · ")}</p>
      {syncBlocked && !activationBlocked && <p className="context-note">Training can be used locally, but source sync is unavailable until its completion mapping is reviewed.</p>}
      {notes.length > 0 && <details className="review-warnings"><summary>View {notes.length} mapping notes</summary>{notes.map((warning, index) => <p key={`${warning.code}-${index}`}><strong>{warning.location}</strong> — {warning.message}</p>)}</details>}
      {preview.targetId && <div className="context-note"><strong>{preview.migration ? "Legacy migration" : "Update option"}</strong><span>{preview.migration ? "Plan ID, version and local sessions are preserved." : describeChanges(data.plans.find((plan) => plan.id === preview.targetId)!, preview.imported).join(" · ")}</span></div>}
      {activationBlocked ? <p className="alert">Workout content could not be identified safely. Activation is blocked.</p> : <div className="review-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void commitPreview(preview.targetId)}>{preview.migration ? "Reconnect existing plan" : preview.targetId ? "Update this training" : "Use this training"} →</button>{preview.targetId && !preview.migration && <button type="button" className="secondary-button" disabled={busy} onClick={() => void commitPreview()}>Add as new training</button>}</div>}
    </section>}
    <div className="library-content"><div className="section-heading"><div><p className="eyebrow">ON THIS DEVICE</p><h2>Saved plans</h2></div><span className="section-count">{data.plans.length} PLANS</span></div>
    {data.plans.length ? <div className="plan-list">{data.plans.map((plan) => <article className="plan-row" key={plan.id}><div><p className="eyebrow">{plan.id === active?.id ? "ACTIVE TRAINING" : plan.source.kind.toUpperCase()}</p><h3>{plan.name}</h3><p className="quiet-note">{plan.workouts.length} workouts · version {plan.version} · updated {new Date(plan.updatedAt).toLocaleDateString()} · {plan.source.kind}</p>{plan.source.kind === "google" && plan.source.authMode !== "oauth" && <p className="context-note">This plan uses the legacy Google connector. Local training remains available. Reconnect with Google to resume sync.</p>}</div><div className="plan-actions"><button type="button" onClick={() => { if (setActivePlan(plan.id)) router.push("/"); }}>Use this training</button><button type="button" onClick={() => plan.source.kind === "google" ? void refreshGoogle(plan) : plan.source.kind === "excel" ? void refreshExcel(plan) : setMessage("This built-in plan has no external source to refresh.")}>{plan.source.kind === "google" && plan.source.authMode !== "oauth" ? "Reconnect with Google" : "Refresh training"}</button><button type="button" onClick={() => { const next = window.prompt("New local training name", plan.name); if (next !== null) renamePlan(plan.id, next); }}>Rename locally</button><button type="button" onClick={() => void remove(plan)}>Remove from this device</button></div></article>)}</div> : <p className="quiet-note">No plans yet. Add a Google Sheet or Excel file above.</p>}</div>
    <Link className="back-link" href="/">← Home</Link>
  </div>;
}
