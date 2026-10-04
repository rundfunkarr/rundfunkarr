"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
export function SignOut() {
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
    <div className="p-2 border-t">
      <Button
        variant="ghost"
        className="w-full justify-start"
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
        Abmelden
      </Button>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
