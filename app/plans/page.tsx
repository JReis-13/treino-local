"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { connectorPing, connectorWorkbook, type ConnectorPing } from "@/lib/connector/client";
import { loadConnectorKey, removeConnectorKey, saveConnectorKey } from "@/lib/connector/credentials";
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
type Preview = { imported: ImportedTraining; targetId?: string; handle?: DirectHandle; connectorKey?: string; suggestedName: string };

export default function PlansPage() {
  const router = useRouter();
  const { data, error, addPlan, refreshPlan, setActivePlan, renamePlan, removePlan } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [targetId, setTargetId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connectorUrl, setConnectorUrl] = useState("");
  const [connectorKey, setConnectorKey] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [connection, setConnection] = useState<ConnectorPing | null>(null);
  const [directAvailable, setDirectAvailable] = useState(false);

  useEffect(() => {
    setDirectAvailable(Boolean(window.isSecureContext && (window as PickerWindow).showOpenFilePicker));
  }, []);
  if (!data) return <div className="loading">Loading training plans…</div>;

  async function inspect(file: File, handle?: DirectHandle, refreshId?: string) {
    setBusy(true); setMessage("Reading training…");
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Choose an .xlsx workbook.");
      const snapshot = await snapshotFromXlsx(new Uint8Array(await file.arrayBuffer()));
      const mode = handle ? "direct" : "copy";
      const imported = parseTrainingSnapshot(snapshot, { kind: "excel", filename: file.name, template: "", mappings: {}, mode }, file.name.replace(/\.xlsx$/i, ""));
      const matching = data?.plans.find((plan) => plan.source.kind === "excel" && plan.source.filename === file.name);
      const chosen = refreshId ?? matching?.id;
      setPreview({ imported, targetId: chosen, handle, suggestedName: imported.name });
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
      } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setMessage(cause instanceof Error ? cause.message : "Could not select the workbook."); else setMessage("File selection cancelled."); }
    } else inputRef.current?.click();
  }

  async function refreshExcel(plan: TrainingPlanRecord) {
    setBusy(true); setMessage("Checking saved file connection…");
    try {
      const handle = await loadFileHandle(plan.id) as DirectHandle | undefined;
      if (handle) { await inspect(await handle.getFile(), handle, plan.id); return; }
      setBusy(false); setMessage("Choose the updated workbook; this browser has no reusable file handle.");
      await selectExcel(plan.id);
    } catch {
      setBusy(false); setMessage("The previous file permission expired. Choose the workbook again.");
      await selectExcel(plan.id);
    }
  }

  async function testConnector() {
    if (!connectorUrl.trim()) { setMessage(sheetUrl.trim() ? "To keep this Sheet synchronized, install the small connector once." : "Paste the Apps Script /exec deployment URL."); return; }
    setBusy(true); setMessage("Testing connector…"); setConnection(null);
    try {
      const result = await connectorPing(connectorUrl.trim(), connectorKey.trim());
      setConnection(result); setMessage("Connection verified. Review the source and import its training.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Connection test failed."); }
    finally { setBusy(false); }
  }

  async function importConnector(refreshId?: string, url = connectorUrl.trim(), key = connectorKey.trim()) {
    setBusy(true); setMessage("Reading training from the connected Sheet…");
    try {
      const result = await connectorWorkbook(url, key);
      const imported = parseTrainingSnapshot(result.snapshot, { kind: "google", filename: result.spreadsheetName,
        connectorUrl: url, mappingId: result.mappingId, sheetUrl: sheetUrl.trim() || result.sheetUrl,
        template: "", mappings: {}, syncEnabled: false }, result.spreadsheetName);
      const matching = data?.plans.find((plan) => plan.source.kind === "google" && plan.source.connectorUrl === url);
      const chosen = refreshId ?? matching?.id;
      setPreview({ imported, targetId: chosen, connectorKey: key, suggestedName: result.spreadsheetName });
      setName(chosen ? data?.plans.find((plan) => plan.id === chosen)?.name ?? result.spreadsheetName : result.spreadsheetName);
      setMessage("Training ready. Review the workout summary before using it. Source sync starts disabled.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not read the connector source."); }
    finally { setBusy(false); }
  }

  async function refreshGoogle(plan: TrainingPlanRecord) {
    if (plan.source.kind !== "google" || !plan.source.connectorUrl) { setMessage("This older Google plan needs a connector. Paste its /exec URL and key below."); return; }
    try {
      const key = await loadConnectorKey(plan.id);
      if (!key) { setConnectorUrl(plan.source.connectorUrl); setMessage("Connection key unavailable on this device. Paste it again to refresh."); return; }
      await importConnector(plan.id, plan.source.connectorUrl, key);
    } catch { setMessage("Could not load the saved connection key. Paste it again to refresh."); }
  }

  async function commitPreview(updateTargetId?: string) {
    if (!preview || preview.imported.warnings.some((warning) => warning.severity === "activationBlocker")) return;
    setBusy(true);
    try {
      const planId = updateTargetId ? (refreshPlan(updateTargetId, preview.imported) ? updateTargetId : null) : addPlan(preview.imported, name);
      if (!planId) throw new Error("The training could not be saved locally.");
      if (preview.handle) try { await saveFileHandle(planId, preview.handle); } catch { setMessage("Training saved, but the file handle could not be remembered. Reconnect the workbook when syncing."); }
      if (preview.connectorKey) try { await saveConnectorKey(planId, preview.connectorKey); } catch { setMessage("Training saved, but this browser could not remember the connection key. Reconnect before syncing."); }
      setActivePlan(planId);
      setPreview(null);
      router.push("/");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not save training."); }
    finally { setBusy(false); }
  }

  async function remove(plan: TrainingPlanRecord) {
    if (!window.confirm(`Remove “${plan.name}” from this device? Completed local sessions stay in History.`)) return;
    if (removePlan(plan.id)) { await Promise.allSettled([removeFileHandle(plan.id), removeConnectorKey(plan.id)]); setMessage(`${plan.name} removed. Its completed local sessions remain in History.`); }
  }

  const active = data.plans.find((plan) => plan.id === data.activePlanId);
  const activationBlocked = preview?.imported.warnings.some((warning) => warning.severity === "activationBlocker") ?? false;
  const syncBlocked = preview?.imported.warnings.some((warning) => warning.severity === "syncBlocker") ?? false;
  const notes = preview?.imported.warnings.filter((warning) => warning.severity !== "info") ?? [];
  return <div className="page-stack"><div className="page-heading"><p className="eyebrow">TRAINING PLAN LIBRARY</p><h1>Training plans<span className="dot-accent">.</span></h1><p>Import once, switch any time. Your completed sessions stay with the plan used.</p></div>
    {(message || error) && <div className={error ? "alert" : "context-note"} role="status">{error ?? message}</div>}
    <div className="source-choice"><div className="source-choice-card"><strong>Connect a Google Sheet</strong><span>Use its small Apps Script connector once. No Google Cloud project is needed.</span><a className="inline-action" href="/google-connector-setup.html" target="_blank" rel="noopener noreferrer">How do I create a connector? ↗</a></div><div className="source-choice-card"><strong>Import Excel file</strong><span>Choose a local .xlsx workbook. Direct updates are used when this browser supports them.</span><button type="button" className="inline-action" disabled={busy} onClick={() => void selectExcel()}>Choose workbook →</button>{directAvailable && <button type="button" className="inline-action" disabled={busy} onClick={() => { setTargetId(undefined); inputRef.current?.click(); }}>Import as safe copy</button>}</div></div>
    <section className="connection-card connector-form"><p className="eyebrow">GOOGLE SHEET CONNECTOR</p><h2>Connect a Google Sheet</h2>
      <label className="date-field"><span>APPS SCRIPT /EXEC URL</span><input type="url" value={connectorUrl} onChange={(event) => { setConnectorUrl(event.target.value); setConnection(null); }} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="url" /></label>
      <label className="date-field"><span>CONNECTION KEY</span><input type={showKey ? "text" : "password"} value={connectorKey} onChange={(event) => { setConnectorKey(event.target.value); setConnection(null); }} autoComplete="off" /></label>
      <button type="button" className="inline-action" onClick={() => setShowKey(!showKey)}>{showKey ? "Hide key" : "Reveal key"}</button>
      <label className="date-field"><span>REGULAR SHEET URL (OPTIONAL)</span><input type="url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
      <div className="connection-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void testConnector()}>Test connection →</button>{connection && <button type="button" className="secondary-button" disabled={busy} onClick={() => void importConnector()}>Import training →</button>}</div>
      {connection && <p className="quiet-note">Connected: {connection.spreadsheetName} · {connection.workoutSheets.join(", ")} · connector v1</p>}
      <p className="quiet-note">A regular Google Sheets link alone cannot authorize synchronization. Install the connector in that Sheet once.</p>
    </section>
    <input ref={inputRef} className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file, undefined, targetId); else setMessage("File selection cancelled."); event.target.value = ""; }} />
    {preview && <section className="review-card"><p className="eyebrow">IMPORT REVIEW</p><h2>Training ready</h2><label className="date-field"><span>LOCAL TRAINING NAME</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><div className="review-stats"><span><strong>{preview.imported.workouts.length}</strong> workouts</span><span><strong>{preview.imported.workouts.flatMap((workout) => workout.blocks).filter((block) => block.kind === "exercise").length}</strong> exercises</span><span><strong>{preview.imported.workouts.flatMap((workout) => workout.blocks).filter((block) => block.kind === "instruction").length}</strong> instruction blocks</span><span><strong>{preview.imported.legacyCompletions.length}</strong> previous workouts</span></div>
      <p className="quiet-note">{preview.imported.workouts.map((workout) => workout.title).join(" · ")}</p>
      {syncBlocked && !activationBlocked && <p className="context-note">Training can be used, but source sync is currently unavailable. Local workouts and history will still save.</p>}
      {notes.length > 0 && <details className="review-warnings"><summary>View {notes.length} mapping note{notes.length === 1 ? "" : "s"}</summary>{notes.map((warning, index) => <p key={`${warning.code}-${index}`}><strong>{warning.location}</strong> — {warning.message}</p>)}</details>}
      {preview.targetId && <div className="context-note"><strong>Update option</strong><span>{describeChanges(data.plans.find((plan) => plan.id === preview.targetId)!, preview.imported).join(" · ")}. Previous session snapshots stay unchanged.</span></div>}
      {activationBlocked ? <p className="alert">Workout content could not be identified safely. Activation is blocked; review the source layout.</p> : <div className="review-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void commitPreview(preview.targetId)}>{preview.targetId ? "Update this training" : "Use this training"} →</button>{preview.targetId ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void commitPreview()}>Add as new training</button> : active && <button type="button" className="secondary-button" disabled={busy} onClick={() => void commitPreview(active.id)}>Replace/update current training</button>}</div>}
    </section>}
    <div className="section-heading"><div><p className="eyebrow">ON THIS DEVICE</p><h2>Saved plans</h2></div><span className="section-count">{data.plans.length} PLANS</span></div>
    {data.plans.length ? <div className="plan-list">{data.plans.map((plan) => <article className="plan-row" key={plan.id}><div><p className="eyebrow">{plan.id === active?.id ? "ACTIVE TRAINING" : plan.source.kind.toUpperCase()}</p><h3>{plan.name}</h3><p className="quiet-note">{plan.workouts.length} workouts · version {plan.version} · updated {new Date(plan.updatedAt).toLocaleDateString()} · {plan.source.kind}</p></div><div className="plan-actions"><button type="button" onClick={() => { if (setActivePlan(plan.id)) router.push("/"); }}>Use this training</button><button type="button" onClick={() => plan.source.kind === "google" ? void refreshGoogle(plan) : plan.source.kind === "excel" ? void refreshExcel(plan) : setMessage("This built-in plan has no external source to refresh.")}>Refresh training</button><button type="button" onClick={() => { const next = window.prompt("New local training name", plan.name); if (next !== null) renamePlan(plan.id, next); }}>Rename locally</button><button type="button" onClick={() => void remove(plan)}>Remove from this device</button></div></article>)}</div> : <p className="quiet-note">No plans yet. Connect a Google Sheet or import an Excel file above.</p>}
    <Link className="back-link" href="/">← Home</Link>
  </div>;
}
