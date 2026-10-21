"use client";
import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "system" | "light" | "dark";
const STORAGE_KEY = "rundfunkarr-theme";
const options: { value: Theme; label: string; short: string; icon: typeof Sun }[] = [
  { value: "system", label: "Darstellung wie das System", short: "System", icon: Monitor },
  { value: "light", label: "Helle Darstellung", short: "Hell", icon: Sun },
  { value: "dark", label: "Dunkle Darstellung", short: "Dunkel", icon: Moon },
];
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    if (read() === "system") apply("system");
  };
  const onStorage = () => {
    apply(read());
    callback();
  };
  media.addEventListener("change", onMedia);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    media.removeEventListener("change", onMedia);
    window.removeEventListener("storage", onStorage);
  };
}

export function ThemeToggle({
  className,
  showLabels = false,
}: {
  className?: string;
  showLabels?: boolean;
}) {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  const select = (next: Theme) => {
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable; the choice then lasts for this page only.
    }
    apply(next);
    listeners.forEach((listener) => listener());
  };
  return (
    <div
      role="radiogroup"
      aria-label="Darstellung"
      className={cn("inline-flex shrink-0 rounded-md border bg-background p-0.5", className)}
    >
      {options.map(({ value, label, short, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={showLabels ? undefined : label}
          title={label}
          onClick={() => select(value)}
          className={cn(
            "flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            showLabels ? "px-3 text-sm" : "w-8",
            theme === value && "bg-accent text-foreground"
          )}
        >
          <Icon className="size-4" />
          {showLabels && <span>{short}</span>}
        </button>
      ))}
    </div>
  );
}
