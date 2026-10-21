"use client";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SignOut({ labelClassName }: { labelClassName?: string }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => {
      void fetch("/api/auth/session", { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => setAuthenticated(!!data.authenticated))
        .catch(() => {});
    };
    refresh();
    window.addEventListener("auth-changed", refresh);
    return () => window.removeEventListener("auth-changed", refresh);
  }, []);
  if (!authenticated) return null;
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-2.5 text-muted-foreground hover:text-foreground"
        onClick={async () => {
          try {
            const response = await fetch("/api/auth/logout", { method: "POST" });
            if (!response.ok) throw new Error();
            window.location.replace("/login");
          } catch {
            setError("Abmelden fehlgeschlagen.");
          }
        }}
      >
        <LogOut className="shrink-0" />
        <span className={cn("truncate", labelClassName)}>Abmelden</span>
      </Button>
      {error && (
        <p role="alert" className={cn("px-2.5 pt-1 text-xs text-danger", labelClassName)}>
          {error}
        </p>
      )}
    </div>
  );
}
