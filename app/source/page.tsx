"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { formatLocalDate } from "@/lib/dates";
import { inspectWorkbook } from "@/lib/excel/adapter";
import { connectorWorkbook, registerConnectorCompletion } from "@/lib/connector/client";
import { connectGoogle, googleStatus, refreshGoogleSheet, syncGoogleDate, syncGoogleLoads } from "@/lib/google/client";
import { loadDeviceConnector, loadPlanConnectorKey } from "@/lib/connector/credentials";
import { loadFileHandle, saveFileHandle } from "@/lib/import/file-handles";
import { snapshotFromXlsx } from "@/lib/import/snapshot";
import { parseTrainingSnapshot } from "@/lib/import/template-parser";
import { plannedCompletionSlot, sessionsWaitingForSource } from "@/lib/sync/logic";
import { applyExcelSync, excelPreparedPatches, verifyExcelCopy } from "@/lib/sync/excel-state";
import { completionState, loadState } from "@/lib/training/sync-state";
import { prepareXlsxSync } from "@/lib/sync/xlsx";
import { activePlan } from "@/lib/training/session";
import { changedLoads, sameSourceLoadAssociation } from "@/lib/training/loads";
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

async function workbookId(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

export default function SourcePage() {
  const { data, error, commitExcelSync, setSyncStatus, setSessionSync, applySourceLoads } = useApp();
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
    googleStatus().then((status) => setGoogleConnected(status.connected)).catch(() => setGoogleConnected(false));
    const result = new URLSearchParams(window.location.search).get("google");
    if (result) {
      setMessage(result === "unauthorized" ? "Esta conta Google não está autorizada a usar a integração Google do Treino Local." :
        result === "connected" ? "Google conectado." : result === "denied" ? "Autorização Google cancelada." : "Falha na conexão Google. Tente novamente.");
      window.history.replaceState({}, "", "/source");
    }
  }, []);
  useEffect(() => {
    if (!plan || plan.source.kind !== "excel") return;
    let alive = true;
    loadFileHandle(plan.id).then(async (handle) => {
      if (!handle || !alive) return;
      const file = await handle.getFile();
      // Validation is also callable from explicit reconnect; the saved handle is checked on plan change.
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
      if (currentPlan.sourceFingerprint && ![imported.sourceFingerprint, imported.legacyFingerprint].includes(currentPlan.sourceFingerprint)) {
        throw new Error("This workbook has changed. Refresh the training in Training plans before syncing.");
      }
      if (imported.source.kind !== "excel" || imported.source.template !== currentPlan.source.template) throw new Error("This is a different workbook template.");
      const mode = handle ? "direct" : "copy";
      const result = verifyExcelCopy(currentPlan, data!.sessions, imported, await workbookId(bytes));
      if (!commitExcelSync(currentPlan.id, result.patches, imported, { filename: file.name, mode }))
        throw new Error("Could not save workbook verification on this device. Reconnect the copy to retry; local sessions remain safe.");
      setSelected({ bytes, filename: file.name, handle, mode });
      if (handle) await saveFileHandle(currentPlan.id, handle).catch(() => {});
      const remaining = sessionsWaitingForSource(applyExcelSync(data!, currentPlan.id, result.patches).sessions, currentPlan.id);
      setMessage(`${result.dates} date(s) and ${result.loads} load update(s) checked against workbook values. ${result.historicalLoads ? "The workbook uses later recorded loads; earlier expressions stay in local History. " : ""}${remaining.length ? remaining.some(session => ["partial", "conflict", "failed"].includes(session.syncStatus)) ? "Some updates still need attention; see each operation below." : "Updates are saved locally; export them below." : "No local workouts are waiting for source sync."} ${handle ? "Direct file connected." : "Safe copy connected; the original file was not overwritten."}`);
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
      const prepared = await prepareXlsxSync(sourceBytes, plan!, pending, data!.sessions);
      if (!prepared.bytes) {
        const imported = parseTrainingSnapshot(await snapshotFromXlsx(sourceBytes), plan!.source, plan!.name);
        const unchangedId = await workbookId(sourceBytes);
        const staged = applyExcelSync(data!, plan!.id, excelPreparedPatches(plan!, data!.sessions, prepared.outcomes, prepared.loadOutcomes, unchangedId));
        const result = verifyExcelCopy(plan!, staged.sessions, imported, unchangedId);
        if (!commitExcelSync(plan!.id, result.patches, imported)) throw new Error("Could not save verification on this device.");
        setMessage("Workbook checked without writing. Dates and loads are listed separately below; review any remaining issues."); return;
      }
      const patches = excelPreparedPatches(plan!, data!.sessions, prepared.outcomes, prepared.loadOutcomes, await workbookId(prepared.bytes));
      if (!commitExcelSync(plan!.id, patches)) throw new Error("Could not remember the prepared updates. No workbook was downloaded or written.");
      const staged = applyExcelSync(data!, plan!.id, patches);
      if (handle) {
        if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") throw new Error("Write permission expired. Reconnect and try again.");
        const latest = new Uint8Array(await (await handle.getFile()).arrayBuffer());
        if (!equalBytes(latest, sourceBytes)) throw new Error("The workbook changed while syncing. No write was made.");
        const writable = await handle.createWritable();
        await writable.write(new Uint8Array(prepared.bytes)); await writable.close();
        const verified = new Uint8Array(await (await handle.getFile()).arrayBuffer());
        if (!equalBytes(verified, prepared.bytes)) throw new Error("The updated file differs from the verified output. Local sessions remain safe.");
        const imported = parseTrainingSnapshot(await snapshotFromXlsx(verified), plan!.source, plan!.name);
        const result = verifyExcelCopy(plan!, staged.sessions, imported, await workbookId(verified));
        if (!commitExcelSync(plan!.id, result.patches, imported)) throw new Error("The file was written, but local verification could not be saved. Reconnect it to retry.");
        setSelected({ ...selected, bytes: verified });
        setMessage(`${result.dates} date(s) and ${result.loads} load update(s) verified in the workbook. Review any remaining load issues below.`);
      } else {
        download(prepared.bytes, selected.filename);
        setSelected(null);
        setMessage("Updated copy generated and download requested. Save it, then reconnect that downloaded copy to verify its dates and loads. Local workouts remain safe on this device.");
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Excel sync failed.";
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
        if (![imported.sourceFingerprint, imported.legacyFingerprint].includes(plan!.sourceFingerprint) || imported.warnings.some((warning) => warning.severity === "syncBlocker"))
          throw new Error("The spreadsheet structure changed. Refresh the training in Training plans before syncing.");
        if (plan!.legacyCompletions.some((item) => !imported.legacyCompletions.some((next) =>
          next.workoutId === item.workoutId && next.sourceSlot === item.sourceSlot && next.date === item.date)))
          throw new Error("Google Sheets dates changed. Refresh the plan and review History before syncing.");
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
        const spreadsheetId = plan!.source.spreadsheetId;
        let synced = 0;
        const { imported } = await refreshGoogleSheet(plan!.source.spreadsheetId, plan!.sourceFingerprint, plan!.source.sourceProof);
        if (![imported.sourceFingerprint, imported.legacyFingerprint].includes(plan!.sourceFingerprint)) throw new Error("Sheet structure changed; review the plan before syncing.");
        if (plan!.legacyCompletions.some((item) => !imported.legacyCompletions.some((next) =>
          next.workoutId === item.workoutId && next.sourceSlot === item.sourceSlot && next.date === item.date)))
          throw new Error("Google Sheets dates changed. Refresh the plan and review History before syncing.");
        applySourceLoads(plan!.id, imported);
        const proof = imported.source.kind === "google" ? imported.source.sourceProof : undefined;
        if (!proof) throw new Error("Google source proof is unavailable.");
        for (const session of pending) {
          if (!session.localDate) continue;
          if (session.completionSyncStatus !== "synced" && !session.completionReceipt) {
            const matching = session.completionAttempted && session.preparedCompletionSlot ? imported.legacyCompletions.filter((entry) =>
              entry.workoutId === session.workoutId && entry.date === session.localDate &&
              entry.sourceSlot === session.preparedCompletionSlot &&
              !data!.sessions.some((other) => other.id !== session.id && other.completionReceipt?.sourceKind === "google" &&
                other.completionReceipt.sourceId === spreadsheetId && other.completionReceipt.slot === entry.sourceSlot)) : [];
            if (matching.length === 1) {
              synced++;
              setSessionSync(session.id, { completionSyncStatus: "synced", preparedCompletionSlot: undefined,
                completionReceipt: { sourceKind: "google",
                sourceId: spreadsheetId, workoutId: session.workoutId, slot: matching[0].sourceSlot,
                syncedAt: new Date().toISOString() }, syncMessage: "Date verified in Sheet after reconnecting." });
            } else if (session.duplicateDateAllowed && session.completionAttempted) {
              setSessionSync(session.id, { completionSyncStatus: "conflict", syncMessage: "Duplicate date needs manual review before retrying." });
            } else {
              setSessionSync(session.id, { completionAttempted: true,
                preparedCompletionSlot: plannedCompletionSlot(imported, session.workoutId) });
              const result = await syncGoogleDate(plan!.source.spreadsheetId, imported.sourceFingerprint, proof, session.workoutId,
                session.localDate, session.duplicateDateAllowed);
              if (result.status === "synced" && result.sourceSlot) { synced++; setSessionSync(session.id, { completionSyncStatus: "synced", preparedCompletionSlot: undefined,
                completionReceipt: { sourceKind: "google", sourceId: plan!.source.spreadsheetId, workoutId: session.workoutId,
                  slot: result.sourceSlot, syncedAt: new Date().toISOString() }, syncMessage: "Date verified in Sheet." }); }
              else setSessionSync(session.id, { completionSyncStatus: "conflict", syncMessage: result.status === "duplicate" ? "Date already exists; review before retrying." : "Completion slots are full." });
            }
          }
          const currentWorkout = imported.workouts.find((item) => item.id === session.workoutId);
          const loads = session.loadSyncStatus === "synced" && !session.loadCorrectionPending ? [] : session.loadCorrectionPending ? session.blocks.flatMap((state) => {
            const block = currentWorkout?.blocks.find((item) => item.kind === "exercise" && item.id === state.blockId);
            return state.completed && block?.kind === "exercise" && state.actualLoad?.trim() &&
              state.actualLoad.trim() !== (block.defaultLoad ?? "") ? [{ blockId: state.blockId, load: state.actualLoad.trim() }] : [];
          }) : changedLoads(session);
          if (session.loadCorrectionPending && !loads.length) setSessionSync(session.id, { loadSyncStatus: "synced", loadCorrectionPending: false });
          if (loads.length) {
            const mapped = loads.filter((change) => sameSourceLoadAssociation(session, currentWorkout, change.blockId));
            if (mapped.length !== loads.length) setSessionSync(session.id, { loadSyncStatus: "conflict", syncMessage: "Ambiguous load mapping; local values are safe." });
            if (mapped.length) {
              const changes = mapped.map((change) => ({ ...change, expected: session.loadCorrectionPending ?
                (currentWorkout?.blocks.find((block) => block.kind === "exercise" && block.id === change.blockId) as { defaultLoad?: string } | undefined)?.defaultLoad ?? "" :
                session.workoutSnapshot.blocks.find((block) => block.kind === "exercise" && block.id === change.blockId)?.kind === "exercise" ?
                (session.workoutSnapshot.blocks.find((block) => block.id === change.blockId) as { defaultLoad?: string }).defaultLoad ?? "" : "" }));
              const result = await syncGoogleLoads(plan!.source.spreadsheetId, imported.sourceFingerprint, proof, session.workoutId, changes);
              applySourceLoads(plan!.id, result.imported);
              if (mapped.length === loads.length) setSessionSync(session.id, { loadSyncStatus: "synced", loadCorrectionPending: false, syncMessage: "Date and loads checked against Sheet." });
            }
          }
          processed.add(session.id);
        }
        setMessage(`${synced} date(s) verified. Load updates were checked separately.`); return;
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
        if (changedLoads(session).length) setSessionSync(session.id, { loadSyncStatus: "conflict",
          syncMessage: "Actual load is saved locally; the legacy connector cannot update source loads. Reconnect with Google OAuth." });
        if (session.completionSyncStatus === "synced" || session.completionReceipt) { processed.add(session.id); continue; }
        if (session.duplicateDateAllowed) {
          setSessionSync(session.id, { completionSyncStatus: "conflict", syncMessage: "Legacy connector cannot identify a second same-day occurrence. Local workout is safe." });
          processed.add(session.id); continue;
        }
        const result = await registerConnectorCompletion(url, key, session.workoutId, session.localDate, plan!.source.mappingId!,
          plan!.source.connectorVersion === 2 ? plan!.source.spreadsheetId : undefined);
        processed.add(session.id);
        if (result.status === "synced") { synced++; setSessionSync(session.id, { completionSyncStatus: "synced", syncMessage: `Date written and verified in ${result.sourceSlot}.` }); }
        else setSessionSync(session.id, { completionSyncStatus: "conflict", syncMessage: result.status === "duplicate" ? "This workout/date already exists in the Sheet; review it before retrying." : "Source completion slots are full. Local history remains saved." });
      }
      setMessage(`${synced} date(s) verified in the connected Google Sheet.`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Google sync failed.";
      setSyncStatus(pending.filter((item) => !processed.has(item.id)).map((item) => item.id), /key|reconnect|unauthorized|expired/i.test(text) ? "authRequired" : "failed", text);
      setMessage(text);
    } finally { setBusy(false); }
  }

  const excelCompleted = data.sessions.filter(session => session.planId === plan.id && session.status === "completed");
  const verifiedDates = excelCompleted.filter(session => session.completionReceipt?.sourceKind === "excel").length;
  const verifiedLoadCells = new Set(excelCompleted.flatMap(session => session.excelSync?.loads.filter(load => load.verified)
    .map(load => `${session.workoutId}:${load.blockId}:${load.sourceSessionId}`) ?? [])).size;
  const historicalLoads = excelCompleted.flatMap(session => session.excelSync?.loads.filter(load => load.verified && load.sourceSessionId !== session.id) ?? []).length;
  const waitingCopy = plan.source.kind === "excel" && pending.some(session => session.preparedCompletionSlot);
  const loadReviewOnly = plan.source.kind === "excel" && pending.length > 0 && pending.every(session => completionState(session) === "synced" && loadState(session) === "conflict");
  const nextStep = busy ? "Checking your source. Wait for this operation to finish." : syncBlocked ?
    "Review the import mapping in Training plans before syncing. Local workouts remain saved." : !pending.length ?
    verifiedDates ? "All required source updates are verified. Connecting a file again is optional until another workout needs an update." : "No updates to send. Finish a workout to create pending source updates." : waitingCopy ?
    "An updated copy was already generated. Reconnect that downloaded file to verify its dates before exporting again. Selecting an older file cannot recreate a date." : loadReviewOnly ?
    "Dates are verified; load updates need review. Reconnect the latest correct downloaded copy, or review the source mapping in Training plans. A new export cannot confirm these unresolved values." : plan.source.kind === "excel" && !selected ?
    "Connect the original workbook, or your latest updated copy, to prepare these updates." : plan.source.kind === "google" && !googleConnected ?
    "Reconnect Google above, then retry these pending updates." : plan.source.kind === "google" && !plan.source.syncEnabled ?
    "Refresh this training in Training plans to restore its verified Google connection, then validate the source here." :
    plan.source.kind === "excel" && selected?.mode === "copy" ?
    "Download an updated workbook copy, save it, then reconnect that copy to confirm synchronization." :
    "Pending updates are saved on this device. Use Sync pending workouts when ready.";
  return <div className="page-stack"><div className="page-heading"><Link className="back-link" href="/settings/#connections">← Connections & Sync</Link><p className="eyebrow">OPTIONAL SOURCE</p><h1>Source sync<span className="dot-accent">.</span></h1><p>{plan.name} works locally even when this source is unavailable.</p></div>
    {(message || error) && <div className={error ? "alert" : "context-note"} role="status">{error ?? message}</div>}
    <section className="connection-card"><p className="eyebrow">{plan.source.kind === "google" ? "GOOGLE SHEETS SOURCE" : plan.source.kind === "excel" ? "LOCALLY IMPORTED EXCEL" : "INDEPENDENT LOCAL PLAN"}</p><h2>{plan.source.kind === "builtin" ? "Local plan" : plan.source.filename}</h2><p>{plan.source.kind === "google" ? plan.source.authMode === "oauth" ? googleConnected ? plan.source.syncEnabled ? "Google connected · verified source connection" : "Google connected · refresh this training before source sync" : "Google sign-in required · local plan available" : "Google Sheet · legacy connector" : plan.source.kind === "excel" ? selected?.mode === "direct" ? "Workbook connected for verified direct updates" : selected ? "Independent safe copy · updated workbook available for download when updates are pending" : "Workbook imported locally · no file currently connected" : "No external sync source is attached."}</p>
      {plan.source.kind === "excel" && <p>Safe-copy mode keeps this plan independent of the original file. Downloading pending updates does not overwrite the original.</p>}
      {plan.source.kind === "excel" && <div className="connection-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void selectExcel()}>Connect workbook →</button>{directAvailable && <button type="button" className="secondary-button" disabled={busy} onClick={() => void selectExcel(true)}>Use safe copy instead</button>}</div>}
      {syncBlocked && <p className="context-note">This training works locally. Its source completion mapping needs review, so source sync is unavailable. Open Training plans to review the import notes.</p>}
      {plan.source.kind === "google" && (plan.source.authMode === "oauth" ? <div className="connection-actions">{googleConnected ? <button type="button" className="primary-button" disabled={busy || syncBlocked} onClick={() => void validateGoogle()}>Validate source →</button> : <button type="button" className="primary-button" onClick={() => connectGoogle("/source")}>Reconnect Google →</button>}{validatedGoogle && <p className="quiet-note">Source verified.</p>}</div> : <div className="connection-actions"><Link className="primary-button" href="/plans/">Reconnect with Google →</Link></div>)}
      {plan.source.kind === "builtin" && <Link className="secondary-button" href="/plans/">Import or connect training →</Link>}
    </section>
    <input ref={inputRef} type="file" className="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void validateExcel(file); else setMessage("File selection cancelled."); event.target.value = ""; }} />
    {plan.source.kind === "excel" && <p className="context-note" role="status">{excelCompleted.length} session(s) saved on this device · {verifiedDates} workbook date(s) verified · {verifiedLoadCells} current load update(s) verified.{historicalLoads > 0 ? " Earlier loads remain in local History; the workbook uses later recorded values." : ""} Notes stay local.</p>}
    <section className="sync-panel"><div className="section-heading"><div><p className="eyebrow">LOCAL SESSIONS</p><h2>{pending.length ? "Source updates" : "Source up to date"}</h2></div><span className="section-count">{pending.length} PENDING</span></div>{pending.length ? <div className="pending-list">{pending.map((session: TrainingSession) => <div key={session.id}><span className="pending-letter">{session.workoutId.slice(0, 1)}</span><span><strong>{session.workoutSnapshot.title}</strong><small>{formatLocalDate(session.localDate!)} · {plan.source.kind === "excel" ? `Date: ${completionState(session) === "synced" ? "verified" : completionState(session) === "conflict" ? "needs attention" : session.preparedCompletionSlot ? "waiting for downloaded copy" : "pending export"} · Loads: ${loadState(session) === "notApplicable" ? "no update required" : loadState(session) === "synced" ? "verified" : loadState(session) === "conflict" ? "needs attention" : session.excelSync ? "waiting for verification" : "pending export"}` : session.syncMessage ?? "Stored locally"}</small>{plan.source.kind === "excel" && session.syncMessage && <small>{session.syncMessage}</small>}</span></div>)}</div> : <p className="quiet-note">No local workouts are waiting for source sync.</p>}
      {plan.source.kind === "excel" && <button type="button" className="primary-button" aria-describedby="source-next-step" disabled={busy || !selected || !pending.length || syncBlocked || waitingCopy || loadReviewOnly} onClick={() => void syncExcel()}>{busy ? "Checking workbook…" : selected?.mode === "direct" ? "Sync pending workouts" : "Save updated workbook copy"} →</button>}
      {plan.source.kind === "google" && plan.source.authMode === "oauth" && <button type="button" className="primary-button" aria-describedby="source-next-step" disabled={busy || !googleConnected || !plan.source.syncEnabled || !pending.length || syncBlocked} onClick={() => void syncGoogle()}>{busy ? "Checking Google Sheet…" : "Sync pending workouts"} →</button>}
      {plan.source.kind !== "builtin" && <p className="quiet-note" id="source-next-step" role="status">{nextStep}</p>}
      <p className="quiet-note">{plan.source.kind === "excel" && selected?.mode === "direct" ? "This selected file will be updated directly only after permission and readback checks." : plan.source.kind === "excel" ? "Safe-copy mode downloads a new file. Your selected file is not overwritten." : "Local sessions remain completed if Google is unavailable or sync fails."}</p></section>
  </div>;
}
