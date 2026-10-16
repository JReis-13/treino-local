import { confirmedLoad } from "@/lib/training/load-editor";
// Separate tab-local drafts never enter sessions, History, source writes or diagnostics.
export interface LoadDraft { sessionId: string; blockId: string; base: string; text: string; mode: "number" | "text"; memoryOnly?: boolean }
const KEY = "treino-load-drafts-v1";
const EMPTY: Record<string, LoadDraft> = {};
let drafts: Record<string, LoadDraft> | undefined;
const listeners = new Set<() => void>();
export const draftKey = (sessionId: string, blockId: string) => JSON.stringify([sessionId, blockId]);
export function loadDrafts(): Record<string, LoadDraft> {
  if (typeof window === "undefined") return EMPTY;
  if (drafts) return drafts;
  drafts = {};
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) for (const [key, value] of Object.entries(parsed).slice(0, 200)) {
      const d = value as LoadDraft;
      if (d && typeof d.sessionId === "string" && typeof d.blockId === "string" && key === draftKey(d.sessionId, d.blockId) &&
        typeof d.base === "string" && typeof d.text === "string" &&
        ["number", "text"].includes(d.mode)) drafts[key] = d;
    }
  } catch { /* Unreadable draft storage must never overwrite a confirmed session. */ }
  return drafts;
}
export const serverLoadDrafts = () => EMPTY;
export function subscribeLoadDrafts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function write(next: Record<string, LoadDraft>) {
  drafts = next;
  let saved = true;
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { saved = false; }
  for (const listener of listeners) listener();
  return saved;
}
export function setLoadDraft(draft: LoadDraft) {
  const next = { ...loadDrafts(), [draftKey(draft.sessionId, draft.blockId)]: draft };
  if (!write(next)) { draft.memoryOnly = true; write({ ...next }); }
}
export function clearLoadDraft(sessionId: string, blockId: string) {
  const next = { ...loadDrafts() }; delete next[draftKey(sessionId, blockId)]; write(next);
}
export function pruneLoadDrafts(active: Array<{ id: string; blockIds: string[]; confirmed?: Record<string, string | undefined> }>) {
  const current = loadDrafts();
  const next = Object.fromEntries(Object.entries(current).filter(([, draft]) =>
    active.some((session) => session.id === draft.sessionId && session.blockIds.includes(draft.blockId) &&
      // A confirmed write can survive a failed draft-store cleanup. Do not resurrect that edit after reload.
      (!session.confirmed || draft.base === (session.confirmed[draft.blockId] ?? "") ||
        confirmedLoad(draft.text, draft.base, draft.mode) !== (session.confirmed[draft.blockId] ?? "")))));
  if (Object.keys(next).length !== Object.keys(current).length) write(next);
}

// Shared across List, Focus and Details; a standalone save cannot race completion.
const actions = new Set<string>();
export function acquireLoadAction(sessionId: string, blockId: string) {
  const key = draftKey(sessionId, blockId);
  if (actions.has(key)) return false;
  actions.add(key); return true;
}
export function releaseLoadAction(sessionId: string, blockId: string) { actions.delete(draftKey(sessionId, blockId)); }
