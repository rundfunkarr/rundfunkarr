"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Search,
  Download,
  Tv,
  Film,
  Settings2,
  Settings,
  Wand2,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navGroups: { items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/search", label: "Suche", icon: Search },
      { href: "/downloads", label: "Downloads", icon: Download },
      { href: "/subscriptions", label: "Suchabos", icon: Bell },
    ],
  },
  {
    items: [
      { href: "/shows", label: "Shows", icon: Tv },
      { href: "/movies", label: "Filme", icon: Film },
      { href: "/rulesets", label: "Rulesets", icon: Settings2 },
    ],
  },
  {
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/setup", label: "Setup", icon: Wand2 },
    ],
  },
];

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex flex-col bg-card border-r border-border h-full",
        // Desktop: full sidebar
        "lg:w-60",
        // Tablet: icons only, expand on hover
        "md:w-16 md:hover:w-60 md:transition-all md:duration-300 md:overflow-hidden",
        // Mobile: hidden (handled by mobile-nav)
        "hidden md:flex",
        className
      )}
    >
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo.svg"
            alt="RundfunkArr"
            width={32}
            height={32}
            className="flex-shrink-0"
          />
          <span className="font-bold text-lg whitespace-nowrap md:opacity-0 md:group-hover:opacity-100 lg:opacity-100 transition-opacity">
            RundfunkArr
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-4 overflow-y-auto group">
        {navGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="space-y-1">
            {groupIndex > 0 && <div className="h-px bg-border mx-2 my-2" />}
            {group.items.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-accent text-accent-foreground font-medium"
                  )}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span className="whitespace-nowrap md:opacity-0 md:group-hover:opacity-100 lg:opacity-100 transition-opacity">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export { navGroups };
export type { NavItem };
