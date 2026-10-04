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
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <MobileNav />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </SettingsProvider>
  );
}
