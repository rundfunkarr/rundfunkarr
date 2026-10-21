"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SettingsProvider } from "@/contexts/settings-context";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === "/login") return;
    const controller = new AbortController();
    const check = () => {
      void fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((status) => {
          if (!controller.signal.aborted && status?.enabled && !status.authenticated) {
            window.location.replace(
              `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`
            );
          }
        })
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [pathname]);
  if (pathname === "/login") return children;
  return (
    <SettingsProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Zum Inhalt springen
      </a>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <MobileNav />
          <main id="main" className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </SettingsProvider>
  );
}
