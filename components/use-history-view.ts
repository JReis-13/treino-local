"use client";

import { useEffect, useRef, useState } from "react";
import { socialViewScope, subscribeSocialChange } from "@/lib/social/client";

type View = { filter: string; scroll: number };
const prefix = "treino-history-view-v1:";
function read(scope: string): View {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(prefix + scope) ?? "null");
    if (parsed && typeof parsed.filter === "string" && parsed.filter.length < 200 && Number.isFinite(parsed.scroll) && parsed.scroll >= 0)
      return parsed;
  } catch { /* View preferences must never block local History. */ }
  return { filter: "active", scroll: 0 };
}
function write(scope: string, view: View) { try { sessionStorage.setItem(prefix + scope, JSON.stringify(view)); } catch { /* Optional view state. */ } }
export function useHistoryView(ready: boolean) {
  const [scope, setScope] = useState(socialViewScope);
  const [filter, setFilter] = useState(() => read(socialViewScope()).filter);
  const latest = useRef({ scope, filter });
  const restoreScroll = useRef(read(socialViewScope()).scroll);
  const restoring = useRef(true);
  useEffect(() => { latest.current = { scope, filter }; }, [scope, filter]);
  useEffect(() => subscribeSocialChange(() => {
    const next = socialViewScope();
    if (next !== latest.current.scope) { const saved = read(next); restoreScroll.current = saved.scroll; restoring.current = true;
      setScope(next); setFilter(saved.filter); }
  }), []);
  useEffect(() => {
    if (!ready) return;
    const target = restoreScroll.current;
    const frame = requestAnimationFrame(() => { window.scrollTo(0, target); restoring.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [ready, scope]);
  useEffect(() => {
    const save = () => { if (!restoring.current) write(latest.current.scope, { filter: latest.current.filter, scroll: window.scrollY }); };
    window.addEventListener("scroll", save, { passive: true });
    return () => { window.removeEventListener("scroll", save); };
  }, []);
  return [filter, (next: string) => { setFilter(next); write(scope, { filter: next, scroll: 0 }); }] as const;
}
