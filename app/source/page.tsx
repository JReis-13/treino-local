"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { formatLocalDate } from "@/lib/dates";
import { inspectWorkbook } from "@/lib/excel/adapter";
import { connectorWorkbook, registerConnectorCompletion } from "@/lib/connector/client";
import { connectGoogle, googleStatus, refreshGoogleSheet, syncGoogleDate } from "@/lib/google/client";
import { loadDeviceConnector, loadPlanConnectorKey } from "@/lib/connector/credentials";
import { loadFileHandle, saveFileHandle } from "@/lib/import/file-handles";
import { snapshotFromXlsx } from "@/lib/import/snapshot";
import { parseTrainingSnapshot } from "@/lib/import/template-parser";
import { sessionsWaitingForSource } from "@/lib/sync/logic";
import { prepareXlsxSync } from "@/lib/sync/xlsx";
import { activePlan } from "@/lib/training/session";
import type { TrainingSession } from "@/types/training";

interface DirectHandle extends FileSystemFileHandle {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}
type PickerWindow = Window & { showOpenFilePicker?: (options: { types: Array<{ description: string; accept: Record<string, string[]> }>; multiple: boolean }) => Promise<DirectHandle[]> };
type SelectedFile = { bytes: Uint8Array; filename: string; handle?: DirectHandle; mode: "direct" | "copy" };

function download(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename.replace(/\.xlsx$/i, "") + "-updated.xlsx";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export default function SourcePage() {
  const { data, error, updateSource, setSyncStatus } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [validatedGoogle, setValidatedGoogle] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [directAvailable, setDirectAvailable] = useState(false);
  const plan = data ? activePlan(data) : undefined;

  useEffect(() => {
    setDirectAvailable(Boolean(window.isSecureContext && (window as PickerWindow).showOpenFilePicker));
    googleStatus().then(setGoogleConnected).catch(() => setGoogleConnected(false));
  }, []);
  useEffect(() => {
    if (!plan || plan.source.kind !== "excel") return;
    let alive = true;
    loadFileHandle(plan.id).then(async (handle) => {
      if (!handle || !alive) return;
      const file = await handle.getFile();
      // Validation is also callable from explicit reconnect; the saved handle is checked on plan change.
      // eslint-disable-next-line react-hooks/immutability
      if (alive) await validateExcel(file, handle as DirectHandle, plan);
    }).catch(() => { if (alive) setMessage("Saved file access expired. Reconnect the workbook when you want to sync."); });
    return () => { alive = false; };
  // A plan change should re-check its stored handle; workbook validation itself is called by the user too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);

  if (!data) return <div className="loading">Loading source connection…</div>;
  if (!plan) return <div className="empty-state"><h1>No training selected</h1><p>Import a training plan first.</p><Link className="primary-button" href="/plans/">Choose training →</Link></div>;
  const pending = sessionsWaitingForSource(data.sessions, plan.id);
  const syncBlocked = plan.importWarnings.some((warning) => warning.severity === "syncBlocker");

  async function validateExcel(file: File, handle?: DirectHandle, currentPlan = plan!) {
    setBusy(true); setMessage("Validating workbook…");
    try {
      if (currentPlan.source.kind !== "excel") throw new Error("Select an Excel training plan first.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!currentPlan.sourceFingerprint && currentPlan.source.template === "jonatha-v1") await inspectWorkbook(bytes);
      const imported = parseTrainingSnapshot(await snapshotFromXlsx(bytes), currentPlan.source, currentPlan.name);
      if (imported.sourceFingerprint !== currentPlan.sourceFingerprint && currentPlan.sourceFingerprint !== undefined) {
        throw new Error("This workbook has changed. Refresh the training in Training plans before syncing.");
      }
      if (imported.source.kind !== "excel" || imported.source.template !== currentPlan.source.template) throw new Error("This is a different workbook template.");
      const mode = handle ? "direct" : "copy";
      setSelected({ bytes, filename: file.name, handle, mode });
      updateSource(currentPlan.id, { ...currentPlan.source, filename: file.name, mode });
      if (handle) await saveFileHandle(currentPlan.id, handle).catch(() => setMessage("Connected, but this browser could not remember the handle. Reconnect after reopening the app."));
      for (const session of pending.filter((item) => item.syncMessage?.startsWith("Copy prepared"))) {
        if (imported.legacyCompletions.some((entry) => entry.workoutId === session.workoutId && entry.date === session.localDate)) {
          setSyncStatus([session.id], "synced", "Saved workbook copy was reconnected and its date verified.");
        }
      }
      setMessage(`${file.name} is compatible. ${mode === "direct" ? "This selected file can be updated directly after permission is granted." : "Safe-copy mode is ready."}`);
    } catch (cause) { setSelected(null); setMessage(cause instanceof Error ? cause.message : "Workbook validation failed. No changes were made."); }
    finally { setBusy(false); }
  }

  async function selectExcel(forceCopy = false) {
    if (!forceCopy && directAvailable) {
      try {
        const [handle] = await (window as PickerWindow).showOpenFilePicker!({ types: [{ description: "Excel workbook", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }], multiple: false });
        if (handle) await validateExcel(await handle.getFile(), typeof handle.createWritable === "function" && typeof handle.queryPermission === "function" && typeof handle.requestPermission === "function" ? handle : undefined);
      } catch (cause) { setMessage(cause instanceof DOMException && cause.name === "AbortError" ? "File selection cancelled." : cause instanceof Error ? cause.message : "Could not choose file."); }
    } else inputRef.current?.click();
  }

  async function syncExcel() {
    if (!selected || plan!.source.kind !== "excel") return;
    setBusy(true); setMessage("Checking current workbook and completion slots…");
    try {
      const handle = selected.handle;
      if (handle && await handle.queryPermission({ mode: "readwrite" }) !== "granted" &&
          await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("Write permission was not granted. Reconnect or use a safe copy.");
      const sourceBytes = handle ? new Uint8Array(await (await handle.getFile()).arrayBuffer()) : selected.bytes;
      const prepared = await prepareXlsxSync(sourceBytes, plan!, pending);
      for (const outcome of prepared.outcomes) {
        if (outcome.decision.kind === "duplicate" || outcome.decision.kind === "full") setSyncStatus([outcome.sessionId], "conflict", outcome.decision.message);
      }
      const written = prepared.outcomes.filter((item) => item.decision.kind === "write").map((item) => item.sessionId);
      if (!prepared.bytes || !written.length) { setMessage("No new dates were written. Review source conflicts in History."); return; }
      if (handle) {
        if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") throw new Error("Write permission expired. Reconnect and try again.");
        const latest = new Uint8Array(await (await handle.getFile()).arrayBuffer());
        if (!equalBytes(latest, sourceBytes)) throw new Error("The workbook changed while syncing. No write was made.");
        const writable = await handle.createWritable();
        await writable.write(new Uint8Array(prepared.bytes)); await writable.close();
        const verified = new Uint8Array(await (await handle.getFile()).arrayBuffer());
        await prepareXlsxSync(verified, plan!, []);
        if (!equalBytes(verified, prepared.bytes)) throw new Error("The updated file differs from the verified output. Local sessions remain safe.");
        setSelected({ ...selected, bytes: verified });
        setSyncStatus(written, "synced", "Date written and verified in the connected workbook.");
        setMessage(`${written.length} workout date${written.length === 1 ? "" : "s"} written directly and verified.`);
      } else {
        download(prepared.bytes, selected.filename);
        setSyncStatus(written, "pending", "Copy prepared. Reconnect the saved copy to verify.");
        setSelected(null);
        setMessage("Updated copy downloaded. Save it, then reconnect that copy to verify its dates. Local workouts remain pending.");
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Excel sync failed.";
      setSyncStatus(pending.map((item) => item.id), "failed", text);
      setMessage(text);
    } finally { setBusy(false); }
  }

  async function validateGoogle() {
    if (plan!.source.kind !== "google") return;
    setBusy(true); setMessage("Validating Google Sheet…");
    try {
      if (plan!.source.authMode === "oauth") {
        if (!plan!.source.spreadsheetId) throw new Error("Spreadsheet identity is missing. Refresh this plan.");
        if (!plan!.source.sourceProof) throw new Error("Refresh this restored training in Training plans before syncing.");
        const { imported } = await refreshGoogleSheet(plan!.source.spreadsheetId, plan!.sourceFingerprint!, plan!.source.sourceProof!);
        if (imported.sourceFingerprint !== plan!.sourceFingerprint || imported.warnings.some((warning) => warning.severity === "syncBlocker"))
          throw new Error("The spreadsheet structure changed. Refresh the training in Training plans before syncing.");
        setValidatedGoogle(true); setMessage("Google Sheet validated. Future workouts sync automatically when online."); return;
      }
      const device = plan!.source.connectorVersion === 2 ? await loadDeviceConnector() : undefined;
      const url = device?.url ?? plan!.source.connectorUrl;
      if (!url) throw new Error("This Google plan needs an Apps Script connector. Reconnect it in Training plans.");
      const key = await loadPlanConnectorKey(plan!.id, plan!.source.connectorVersion);
      if (!key) throw new Error("Connection key is unavailable on this device. Reconnect in Training plans.");
      if (plan!.source.connectorVersion === 2 && !plan!.source.spreadsheetId) throw new Error("Spreadsheet identity is missing. Refresh this plan.");
      const result = await connectorWorkbook(url, key, plan!.source.connectorVersion === 2 ? plan!.source.spreadsheetId : undefined);
      const parsed = parseTrainingSnapshot(result.snapshot, plan!.source, plan!.name);
      if (parsed.sourceFingerprint !== plan!.sourceFingerprint) throw new Error("Google Sheet changed. Refresh the training before enabling sync.");
      if (result.mappingId !== plan!.source.mappingId || syncBlocked || parsed.warnings.some((warning) => warning.severity === "syncBlocker"))
        throw new Error("Completion mapping changed or is uncertain. Training remains usable locally; source sync is unavailable.");
      setValidatedGoogle(true); setMessage("Source validated. Enable sync to allow narrow date updates when you finish a workout.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Google validation failed."); }
    finally { setBusy(false); }
  }

  async function syncGoogle() {
    if (plan!.source.kind !== "google" || syncBlocked) return;
    if (plan!.source.authMode !== "oauth" && !plan!.source.mappingId) return;
    setBusy(true); setMessage("Checking Google Sheet and syncing pending dates…");
    const processed = new Set<string>();
    try {
      if (plan!.source.authMode === "oauth") {
        if (!plan!.source.spreadsheetId || !plan!.source.sourceProof || !plan!.sourceFingerprint) throw new Error("Google source identity is missing. Refresh this training.");
        let synced = 0;
        for (const session of pending) {
          if (!session.localDate) continue;
          const result = await syncGoogleDate(plan!.source.spreadsheetId, plan!.sourceFingerprint, plan!.source.sourceProof, session.workoutId, session.localDate);
          processed.add(session.id);
          if (result.status === "synced") { synced++; setSyncStatus([session.id], "synced", `Date written and verified in ${result.sourceSlot}.`); }
          else setSyncStatus([session.id], "conflict", result.status === "duplicate" ? "This workout/date already exists in the Sheet." : "Completion slots are full.");
        }
        setMessage(`${synced} date(s) verified in the connected Google Sheet.`); return;
      }
      const device = plan!.source.connectorVersion === 2 ? await loadDeviceConnector() : undefined;
      const url = device?.url ?? plan!.source.connectorUrl;
      if (!url) throw new Error("Google connector unavailable. Reconnect in Training plans.");
      const key = await loadPlanConnectorKey(plan!.id, plan!.source.connectorVersion);
      if (!key) throw new Error("Connection key unavailable. Reconnect this Sheet in Training plans.");
      if (plan!.source.connectorVersion === 2 && !plan!.source.spreadsheetId) throw new Error("Spreadsheet identity is missing. Refresh this plan.");
      let synced = 0;
      for (const session of pending) {
        if (!session.localDate) continue;
        const result = await registerConnectorCompletion(url, key, session.workoutId, session.localDate, plan!.source.mappingId!,
          plan!.source.connectorVersion === 2 ? plan!.source.spreadsheetId : undefined);
        processed.add(session.id);
        if (result.status === "synced") { synced++; setSyncStatus([session.id], "synced", `Date written and verified in ${result.sourceSlot}.`); }
        else setSyncStatus([session.id], "conflict", result.status === "duplicate" ? "This workout/date already exists in the Sheet; review it before retrying." : "Source completion slots are full. Local history remains saved.");
      }
      setMessage(`${synced} date(s) verified in the connected Google Sheet.`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Google sync failed.";
      setSyncStatus(pending.filter((item) => !processed.has(item.id)).map((item) => item.id), /key|reconnect|unauthorized|expired/i.test(text) ? "authRequired" : "failed", text);
      setMessage(text);
    } finally { setBusy(false); }
  }

  return <div className="page-stack"><div className="page-heading"><p className="eyebrow">OPTIONAL SOURCE</p><h1>Source sync<span className="dot-accent">.</span></h1><p>{plan.name} works locally even when this source is unavailable.</p></div>
    {(message || error) && <div className={error ? "alert" : "context-note"} role="status">{error ?? message}</div>}
    <section className="connection-card"><p className="eyebrow">CONNECTED SOURCE</p><h2>{plan.source.kind === "builtin" ? "Local plan" : plan.source.filename}</h2><p>{plan.source.kind === "google" ? plan.source.authMode === "oauth" ? "Google Sheet · connected with Google" : "Google Sheet · legacy connector" : plan.source.kind === "excel" ? `${selected?.mode === "direct" ? "Direct connected file" : selected ? "Safe-copy mode" : "Reconnect when ready"} · ${plan.source.template}` : "No external sync source is attached."}</p>
      {plan.source.kind === "excel" && <div className="connection-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void selectExcel()}>Connect workbook →</button>{directAvailable && <button type="button" className="secondary-button" disabled={busy} onClick={() => void selectExcel(true)}>Use safe copy instead</button>}</div>}
      {syncBlocked && <p className="context-note">This training works locally. Its source completion mapping needs review, so source sync is unavailable.</p>}
      {plan.source.kind === "google" && (plan.source.authMode === "oauth" ? <div className="connection-actions">{googleConnected ? <button type="button" className="primary-button" disabled={busy || syncBlocked} onClick={() => void validateGoogle()}>Validate source →</button> : <button type="button" className="primary-button" onClick={() => connectGoogle("/source")}>Reconnect Google →</button>}{validatedGoogle && <p className="quiet-note">Source verified.</p>}</div> : <div className="connection-actions"><Link className="primary-button" href="/plans/">Reconnect with Google →</Link></div>)}
      {plan.source.kind === "builtin" && <Link className="secondary-button" href="/plans/">Import or connect training →</Link>}
    </section>
    <input ref={inputRef} type="file" className="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void validateExcel(file); else setMessage("File selection cancelled."); event.target.value = ""; }} />
    <section className="sync-panel"><div className="section-heading"><div><p className="eyebrow">LOCAL SESSIONS</p><h2>Waiting to sync</h2></div><span className="section-count">{pending.length} PENDING</span></div>{pending.length ? <div className="pending-list">{pending.map((session: TrainingSession) => <div key={session.id}><span className="pending-letter">{session.workoutId.slice(0, 1)}</span><span><strong>{session.workoutSnapshot.title}</strong><small>{formatLocalDate(session.localDate!)} · {session.syncMessage ?? "Stored locally"}</small></span></div>)}</div> : <p className="quiet-note">No local workouts are waiting for source sync.</p>}
      {plan.source.kind === "excel" && <button type="button" className="primary-button" disabled={busy || !selected || !pending.length || syncBlocked} onClick={() => void syncExcel()}>{busy ? "Checking workbook…" : selected?.mode === "direct" ? "Sync pending workouts" : "Save updated workbook copy"} →</button>}
      {plan.source.kind === "google" && plan.source.authMode === "oauth" && <button type="button" className="primary-button" disabled={busy || !googleConnected || !plan.source.syncEnabled || !pending.length || syncBlocked} onClick={() => void syncGoogle()}>{busy ? "Checking Google Sheet…" : "Sync pending workouts"} →</button>}
      <p className="quiet-note">{plan.source.kind === "excel" && selected?.mode === "direct" ? "This selected file will be updated directly only after permission and readback checks." : plan.source.kind === "excel" ? "Safe-copy mode downloads a new file. Your selected file is not overwritten." : "Local sessions remain completed if Google is unavailable or sync fails."}</p></section>
    <Link className="back-link" href="/plans/">← Training plans</Link>
  </div>;
}
