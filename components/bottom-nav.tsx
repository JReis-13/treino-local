"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/history/", label: "History", icon: "◷" },
  { href: "/plans/", label: "Plans", icon: "▦" },
  { href: "/stats/", label: "Stats", icon: "▥" },
  { href: "/settings/", label: "Settings", icon: "⚙" },
];

export function BottomNav() {
  const path = usePathname();
  return <nav className="bottom-nav" aria-label="Main navigation">{items.map((item) => { const active = path === item.href || (item.href !== "/" && path.startsWith(item.href)); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={active ? "nav-item active" : "nav-item"}>
    <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
  </Link>; })}</nav>;
}
