"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Search,
  Download,
  Bell,
  Tv,
  Film,
  Settings2,
  Settings,
  FileText,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Betrieb",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/search", label: "Suche", icon: Search },
      { href: "/downloads", label: "Downloads", icon: Download },
      { href: "/subscriptions", label: "Suchabos", icon: Bell },
    ],
  },
  {
    label: "Bibliothek",
    items: [
      { href: "/shows", label: "Serien", icon: Tv },
      { href: "/movies", label: "Filme", icon: Film },
      { href: "/rulesets", label: "Rulesets", icon: Settings2 },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Einstellungen", icon: Settings },
      { href: "/logs", label: "Diagnose & Protokoll", icon: FileText },
      { href: "/setup", label: "Setup", icon: Wand2 },
    ],
  },
];

/** Text that fades in when the tablet sidebar expands on hover. */
export const collapsibleLabel =
  "transition-opacity md:opacity-0 md:group-hover/nav:opacity-100 md:group-focus-within/nav:opacity-100 lg:opacity-100";

export function NavList({
  collapsible = false,
  onNavigate,
}: {
  collapsible?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const labelClass = collapsible ? collapsibleLabel : undefined;
  return (
    <nav aria-label="Hauptnavigation" className="flex flex-col gap-5">
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className={cn("eyebrow mb-1.5 px-3", labelClass)}>{group.label}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-9 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/85 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      active &&
                        "bg-primary/10 font-medium text-foreground before:absolute before:-left-3 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r-full before:bg-primary"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-[18px] shrink-0",
                        active ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                    <span className={cn("truncate", labelClass)}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
