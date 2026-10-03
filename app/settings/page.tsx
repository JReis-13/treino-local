"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { connectGoogle, disconnectGoogle, googleStatus } from "@/lib/google/client";
import { createBackup, MAX_BACKUP_BYTES, parseBackup, SAFETY_SNAPSHOT_KEY } from "@/lib/training/backup";
import { parseTrainingData } from "@/lib/training/storage";
import type { TrainingData } from "@/types/training";

function downloadJson(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function SettingsPage() {
  const { data, error, restoreData } = useApp();
  const picker = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<{ data: TrainingData; createdAt: string } | null>(null);
  const [message, setMessage] = useState("");
  const [hasSafetySnapshot, setHasSafetySnapshot] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState<string | undefined>();
  useEffect(() => { try { setHasSafetySnapshot(Boolean(localStorage.getItem(SAFETY_SNAPSHOT_KEY))); } catch { /* Storage status is shown on restore. */ } }, []);
  useEffect(() => {
    googleStatus().then((status) => { setGoogleConnected(status.connected); setGoogleEmail(status.email); })
      .catch(() => setGoogleConnected(false));
    const result = new URLSearchParams(window.location.search).get("google");
    if (result) {
      setMessage(result === "unauthorized" ? "Esta conta Google não está autorizada a usar a integração Google do Treino Local." :
        result === "connected" ? "Google conectado." : result === "denied" ? "Autorização Google cancelada." : "Falha na conexão Google. Tente novamente.");
      window.history.replaceState({}, "", "/settings");
    }
  }, []);

  async function inspect(file: File) {
    setCandidate(null);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup file is too large.");
      const parsed = parseBackup(await file.text());
      setCandidate(parsed);
      setMessage("Backup validated. Review the summary before restoring.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not read backup."); }
  }

  function restore() {
    if (!data || !candidate) return;
    const sessions = candidate.data.sessions.filter((session) => session.status === "completed").length;
    if (!window.confirm(`Replace local data with this backup? It contains ${candidate.data.plans.length} plans and ${sessions} completed sessions. A safety snapshot of your current data will be saved on this device first.`)) return;
    try {
      localStorage.setItem(SAFETY_SNAPSHOT_KEY, JSON.stringify(data));
      setHasSafetySnapshot(true);
      if (!restoreData(candidate.data)) throw new Error("Storage could not save the restored data. Your current data remains available in the safety snapshot.");
      setCandidate(null);
      setMessage("Backup restored. Google and file permissions must be reconnected on this device before syncing.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Restore failed. Current data was not replaced."); }
  }

  if (!data) return <div className="loading">Loading local settings…</div>;
  return <div className="page-stack"><div className="page-heading"><p className="eyebrow">ON THIS DEVICE</p><h1>Settings<span className="dot-accent">.</span></h1><p>Keep a copy of your plans and workout history. Google credentials are excluded.</p></div>
    {(message || error) && <div className={error ? "alert" : "context-note"} role="status">{error ?? message}</div>}
    <section className="review-card"><p className="eyebrow">GOOGLE SHEETS</p><h2>{googleConnected ? "Google account connected" : "Not connected"}</h2>{googleConnected && googleEmail && <p className="quiet-note">{googleEmail}</p>}<p className="quiet-note">Connect once, then import each training by pasting its Google Sheets URL. Your workout history stays on this device.</p><div className="connection-actions">{googleConnected ? <button type="button" className="secondary-button" onClick={() => void (async () => { try { await disconnectGoogle(); setGoogleConnected(false); setGoogleEmail(undefined); setMessage("Google disconnected. Plans and workout history remain saved locally. Reconnect to resume sync."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not disconnect Google."); } })()}>Disconnect Google</button> : <button type="button" className="primary-button" onClick={() => connectGoogle("/settings")}>{message.includes("não está autorizada") ? "Tentar outra conta Google →" : "Connect Google →"}</button>}<Link className="secondary-button" href="/plans/">Training plans →</Link></div></section>
    <Link className="secondary-button" href="/source/">Source sync and pending updates →</Link>
    <section className="review-card"><h2>Data backup</h2><p className="quiet-note">Export includes saved plans, versions, sessions and history. It excludes Google tokens and legacy connector credentials. A restored Google plan needs Google connected before syncing.</p>
      <div className="connection-actions"><button type="button" className="primary-button" onClick={() => { try { downloadJson(createBackup(data), `treino-local-backup-${new Date().toISOString().slice(0, 10)}.json`); setMessage("Backup download started."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Backup export failed."); } }}>Export backup</button>
        <button type="button" className="secondary-button" onClick={() => picker.current?.click()}>Import backup</button></div>
      {hasSafetySnapshot && <button type="button" className="inline-action" onClick={() => { try { const raw = localStorage.getItem(SAFETY_SNAPSHOT_KEY); if (!raw) throw new Error("Safety snapshot is unavailable."); downloadJson(createBackup(parseTrainingData(raw)), "treino-local-before-restore.json"); setMessage("Safety snapshot download started."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not export safety snapshot."); } }}>Download previous data safety snapshot</button>}
      <input ref={picker} type="file" accept=".json,application/json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file); else setMessage("File selection cancelled."); event.target.value = ""; }} />
      {candidate && <div className="context-note"><strong>Validated backup from {new Date(candidate.createdAt).toLocaleString()}</strong><span>{candidate.data.plans.length} plans · {candidate.data.sessions.filter((session) => session.status === "completed").length} completed sessions · {candidate.data.sessions.filter((session) => session.status === "inProgress").length} in-progress sessions</span><span>Restoring replaces current local data after a safety snapshot is saved.</span><button type="button" className="primary-button" onClick={restore}>Restore this backup</button><button type="button" className="secondary-button" onClick={() => { setCandidate(null); setMessage("Restore cancelled."); }}>Cancel</button></div>}
    </section>
    <Link className="back-link" href="/">← Home</Link>
  </div>;
}
