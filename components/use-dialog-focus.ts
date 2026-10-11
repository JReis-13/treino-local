"use client";

import { useEffect, type RefObject } from "react";

export function useDialogFocus(open: boolean, panel: RefObject<HTMLElement | null>, returnTo: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open || !panel.current) return;
    const sheet = panel.current;
    const target = returnTo.current;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')]
      .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
    controls()[0]?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!sheet.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = before;
      window.requestAnimationFrame(() => { if (target?.isConnected) target.focus(); });
    };
  }, [open, panel, returnTo]);
}
