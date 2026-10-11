"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/history/", label: "History", icon: "◷" },
  { href: "/friends/", label: "Friends", icon: "♧" },
  { href: "/stats/", label: "Stats", icon: "▥" },
  { href: "/settings/", label: "Settings", icon: "⚙" },
];

export function BottomNav() {
  const path = usePathname().replace(/\/+$/, "") || "/";
  const matches = (href: string) => { const target = href.replace(/\/+$/, "") || "/";
    return path === target || (target !== "/" && path.startsWith(`${target}/`)); };
  return <nav className="bottom-nav" aria-label="Main navigation">{items.map((item) => { const inFriendsSettings = matches("/settings/friends/");
    const active = item.href === "/friends/" ? matches(item.href) || inFriendsSettings :
      item.href === "/settings/" ? matches(item.href) && !inFriendsSettings : matches(item.href);
    return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={active ? "nav-item active" : "nav-item"}>
    <span className="nav-icon" aria-hidden="true">{item.label === "Friends" ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 5v3"/></svg> : item.icon}</span><span>{item.label}</span>
  </Link>; })}</nav>;
}
