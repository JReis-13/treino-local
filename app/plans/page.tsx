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
  const [connectedEmail, setConnectedEmail] = useState<string | undefined>();
  const [directAvailable, setDirectAvailable] = useState(false);
  const [stage, setStage] = useState<"library" | "choose" | "google" | "importing" | "review">("library");

  useEffect(() => {
    setDirectAvailable(Boolean(window.isSecureContext && (window as PickerWindow).showOpenFilePicker));
    googleStatus().then((status) => { setConnected(status.connected); setConnectedEmail(status.email); }).catch(() => setConnected(false));
    const result = new URLSearchParams(window.location.search).get("google");
    if (result) {
      setStage("google");
      setMessage(result === "connected" ? "Google connected. Paste a Google Sheets URL to import training." :
        result === "denied" ? "Google authorization was cancelled." :
        result === "unauthorized" ? "Esta conta Google não está autorizada a usar a integração Google do Treino Local." :
        "Google connection failed. Try again.");
      window.history.replaceState({}, "", "/plans");
    } else {
      const source = new URLSearchParams(window.location.search).get("source");
      if (source === "google") setStage("google");
      else if (source === "excel") setStage("choose");
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
    setBusy(true); setStage("importing"); setMessage("Reading training…"); window.scrollTo(0, 0);
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
    } catch (cause) { setStage("choose"); setMessage(cause instanceof Error ? cause.message : "Could not read the workbook."); }
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
    setBusy(true); setStage("importing"); setMessage("Reading spreadsheet…"); window.scrollTo(0, 0);
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
    } catch (cause) { setStage("google"); setMessage(cause instanceof Error ? cause.message : "Could not import Google Sheet."); }
    finally { setBusy(false); }
  }
  async function refreshGoogle(plan: TrainingPlanRecord) {
    if (plan.source.kind !== "google") return;
    if (plan.source.authMode === "oauth" && plan.source.spreadsheetId && plan.source.sourceProof && plan.sourceFingerprint) {
      setBusy(true); setStage("importing"); setMessage("Refreshing spreadsheet…"); window.scrollTo(0, 0);
      try { const { imported } = await refreshGoogleSheet(plan.source.spreadsheetId, plan.sourceFingerprint, plan.source.sourceProof);
        setPreview({ imported, targetId: plan.id }); setName(plan.name); setStage("review"); window.scrollTo(0, 0); setMessage("Updated training ready for review."); }
      catch (cause) { setStage("library"); setMessage(cause instanceof Error ? cause.message : "Could not refresh spreadsheet."); }
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
  return <div className={`page-stack plans-page stage-${stage}`}>
    <div className="page-heading"><p className="eyebrow">YOUR TRAINING</p><h1>{stage === "library" ? "Training plans" : stage === "choose" ? "Add training" : stage === "google" ? "Google Sheets" : stage === "importing" ? "Importing training" : "Import review"}<span className="dot-accent">.</span></h1>
      <p>{stage === "library" ? "Your plans, ready whenever you are." : stage === "choose" ? "Where does your training come from?" : stage === "review" ? "Check the essentials before using this plan." : stage === "importing" ? "Reading and checking your training." : "Paste a link to a training Sheet you can access."}</p></div>
    {stage !== "library" && stage !== "importing" && <button type="button" className="inline-action" onClick={() => { setStage(stage === "review" ? "choose" : stage === "google" ? "choose" : "library"); setPreview(null); setMessage(""); }}>← Back</button>}
    {stage === "library" && <>
      {active && <section className="active-plan-card"><p className="eyebrow">CURRENT TRAINING</p><h2>{active.name}</h2><p>{active.workouts.length} workouts · {active.workouts.flatMap((workout) => workout.blocks).filter((block) => block.kind === "exercise").length} exercises</p><Link href="/" className="active-plan-link">Open training <span aria-hidden="true">→</span></Link><details className="plan-manage"><summary>Manage this training</summary><button type="button" onClick={() => active.source.kind === "google" ? void refreshGoogle(active) : active.source.kind === "excel" ? void refreshExcel(active) : setMessage("This local plan has no external source to refresh.")}>{active.source.kind === "google" && active.source.authMode !== "oauth" ? "Reconnect with Google" : "Refresh training"}</button><button type="button" onClick={() => { const next = window.prompt("New local training name", active.name); if (next !== null) renamePlan(active.id, next); }}>Rename locally</button><button type="button" onClick={() => void remove(active)}>Remove from this device</button></details></section>}
      <button type="button" className="primary-button add-training-cta" onClick={() => { setStage("choose"); setMessage(""); window.scrollTo(0, 0); }}>+ Add training</button>
      {(message || error) && <div className={error ? "alert" : "context-note"} role="status">{error ?? message}</div>}
      <section className="library-content"><div className="section-heading"><div><p className="eyebrow">ON THIS DEVICE</p><h2>{active ? "Other plans" : "Saved plans"}</h2></div><span className="section-count">{active ? data.plans.length - 1 : data.plans.length} PLANS</span></div>
        {data.plans.filter((plan) => plan.id !== active?.id).length ? <div className="plan-list">{data.plans.filter((plan) => plan.id !== active?.id).map((plan) => <article className="plan-row" key={plan.id}><div><p className="eyebrow">{plan.source.kind === "google" ? "GOOGLE SHEETS" : plan.source.kind === "excel" ? "EXCEL FILE" : "LOCAL PLAN"}</p><h3>{plan.name}</h3><p className="quiet-note">{plan.workouts.length} workouts</p>{plan.source.kind === "google" && plan.source.authMode !== "oauth" && <p className="context-note">Reconnect with Google to resume source sync.</p>}</div><div className="plan-actions"><button type="button" onClick={() => { if (setActivePlan(plan.id)) router.push("/"); }}>Use this training</button><details className="plan-manage"><summary>Manage</summary><button type="button" onClick={() => plan.source.kind === "google" ? void refreshGoogle(plan) : plan.source.kind === "excel" ? void refreshExcel(plan) : setMessage("This local plan has no external source to refresh.")}>{plan.source.kind === "google" && plan.source.authMode !== "oauth" ? "Reconnect with Google" : "Refresh training"}</button><button type="button" onClick={() => { const next = window.prompt("New local training name", plan.name); if (next !== null) renamePlan(plan.id, next); }}>Rename locally</button><button type="button" onClick={() => void remove(plan)}>Remove from this device</button></details></div></article>)}</div> : <p className="quiet-note">{active ? "No other plans saved yet." : "Add a Google Sheet or Excel file to get started."}</p>}
      </section>
    </>}
    {stage === "choose" && <><div className="source-choice"><button type="button" className="source-choice-card" aria-label="Use Google Sheets" onClick={() => { setStage("google"); setMessage(""); window.scrollTo(0, 0); }}><span className="source-icon" aria-hidden="true">▦</span><span className="source-choice-copy"><strong>Google Sheets</strong><small>Import a training Sheet from Google.</small></span><b aria-hidden="true">›</b></button><button type="button" className="source-choice-card" aria-label="Choose workbook" disabled={busy} onClick={() => void selectExcel()}><span className="source-icon" aria-hidden="true">⇩</span><span className="source-choice-copy"><strong>Excel file</strong><small>Choose an .xlsx workbook on this device.</small></span><b aria-hidden="true">›</b></button>{directAvailable && <button type="button" className="inline-action" disabled={busy} onClick={() => { setTargetId(undefined); inputRef.current?.click(); }}>Import as safe copy</button>}</div>{(message || error) && <div className={error ? "alert" : "context-note"} role="status">{error ?? message}</div>}</>}
    {stage === "google" && <section className="connection-card connector-form"><p className="eyebrow">GOOGLE SHEETS</p><h2>{connected ? "Google account connected" : "Connect Google"}</h2><p>{connected ? connectedEmail ?? "Ready to import a Sheet you can access." : "Connect once, then paste your training Sheet link."}</p>
      {migrationId && <p className="context-note">Reconnect {data.plans.find((plan) => plan.id === migrationId)?.name} with its original Sheet URL. Your local sessions stay saved.</p>}
      {!connected ? <button type="button" className="primary-button" onClick={() => connectGoogle("/plans")}>{message.includes("não está autorizada") ? "Tentar outra conta Google →" : "Connect Google →"}</button> : <><label className="date-field"><span>PASTE GOOGLE SHEETS LINK</span><input type="url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoComplete="url" /></label><button type="button" className="primary-button" disabled={busy || !sheetUrl.trim()} onClick={() => void importGoogle(migrationId)}>{migrationId ? "Reconnect this training →" : "Import training →"}</button></>}
      {(message || error) && <div className={error ? "alert" : "context-note"} role="status">{error ?? message}</div>}
      <details className="review-warnings"><summary>How to add a training</summary><p>Connect Google, copy your training Sheet URL, paste it here, and tap Import training.</p></details>
    </section>}
    {stage === "importing" && <section className="import-progress" role="status" aria-live="polite"><span className="import-spinner" aria-hidden="true" /><h2>Reading your training…</h2><p>{message}</p><ol><li>Opening source</li><li>Identifying workouts</li><li>Checking structure</li></ol></section>}
    {stage === "review" && preview && <section className="review-card import-review"><p className="eyebrow">IMPORT REVIEW</p><h2>Training ready</h2><p className="quiet-note">{preview.imported.workouts.map((workout) => workout.title).join(" · ")}</p><div className="review-stats"><span><strong>{preview.imported.workouts.length}</strong> workouts</span><span><strong>{preview.imported.workouts.flatMap((workout) => workout.blocks).filter((block) => block.kind === "exercise").length}</strong> exercises</span><span><strong>{preview.imported.legacyCompletions.length}</strong> previous workouts</span></div>
      <details className="review-warnings"><summary>Review exercise plan loads</summary><p className="quiet-note">These values come from the source. A new workout starts with your last locally used load when available; the plan values stay separate.</p>{preview.imported.workouts.map((workout) => <div key={workout.id}><strong>{workout.title}</strong>{workout.blocks.filter((block) => block.kind === "exercise").map((block) => block.kind === "exercise" ? <p key={block.id}>{block.name}: <strong>{block.defaultLoad ?? "No plan load"}</strong></p> : null)}</div>)}</details>
      {activationBlocked && <p className="alert" role="alert">Workout content could not be identified safely. Activation is blocked.</p>}
      {syncBlocked && !activationBlocked && <p className="context-note">Training is available locally; source sync needs mapping review.</p>}
      {notes.length > 0 && <details className="review-warnings"><summary>{notes.length} import note{notes.length === 1 ? "" : "s"} · View details</summary>{notes.map((warning, index) => <p key={`${warning.code}-${index}`}>{warning.message} <small>({warning.location})</small></p>)}</details>}
      {preview.targetId && <div className="context-note"><strong>{preview.migration ? "Legacy migration" : "Training update"}</strong><span>{preview.migration ? "Plan identity and local sessions are preserved." : describeChanges(data.plans.find((plan) => plan.id === preview.targetId)!, preview.imported).join(" · ")}</span></div>}
      {!activationBlocked && <div className="review-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void commitPreview(preview.targetId)}>{preview.migration ? "Reconnect existing plan" : preview.targetId ? "Update this training" : "Use this training"} →</button>{preview.targetId && !preview.migration && <button type="button" className="secondary-button" disabled={busy} onClick={() => void commitPreview()}>Add as new training</button>}</div>}
      <label className="date-field"><span>NAME ON THIS DEVICE</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
      {(message || error) && <p className={error ? "alert" : "quiet-note"} role="status">{error ?? message}</p>}
    </section>}
    <input ref={inputRef} className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file, undefined, targetId); else setMessage("File selection cancelled."); event.target.value = ""; }} />
    {stage === "library" && <Link className="back-link" href="/">← Home</Link>}
  </div>;
}
