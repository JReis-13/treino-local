import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AppProvider } from "@/components/app-provider";
import { BottomNav } from "@/components/bottom-nav";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import { ClientDiagnostics } from "@/components/client-diagnostics";
import "./globals.css";

export const metadata: Metadata = {
  title: "Treino Local",
  description: "A simple local-first workout companion.",
  applicationName: "Treino Local",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Treino Local" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#172323", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppProvider><RegisterServiceWorker /><ClientDiagnostics /><div className="site-shell">
    <header className="topbar"><Link className="brand" href="/" aria-label="Treino Local home"><span className="brand-mark">T<span>.</span></span><span>TREINO<span className="brand-light">LOCAL</span></span></Link><span className="topbar-caption">YOUR GYM COMPANION</span></header>
    <main className="main-content">{children}</main>
    <BottomNav />
  </div></AppProvider></body></html>;
}
