"use client";
import Image from "next/image";
import Link from "next/link";
import packageJson from "../../../package.json";
import { SignOut } from "@/components/auth/sign-out";
import { cn } from "@/lib/utils";
import { NavList, collapsibleLabel } from "./nav-list";
import { ThemeToggle } from "./theme-toggle";

export function Sidebar({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "group/nav hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex",
        // Tablet: icon rail that expands on hover. Desktop: always expanded.
        "md:w-16 md:overflow-hidden md:transition-[width] md:duration-200 md:hover:w-60 md:focus-within:w-60 lg:w-60",
        className
      )}
    >
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-4">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Image
            src="/logo.svg"
            alt=""
            width={32}
            height={32}
            priority
            className="size-8 shrink-0 rounded-lg"
          />
          <span
            className={cn(
              "whitespace-nowrap text-[15px] font-semibold tracking-tight",
              collapsibleLabel
            )}
          >
            RundfunkArr
          </span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
        <NavList collapsible />
      </div>
      <div className="shrink-0 space-y-2 border-t border-sidebar-border px-3 py-3">
        <SignOut labelClassName={collapsibleLabel} />
        <div className="flex items-center justify-between gap-2">
          <ThemeToggle className={collapsibleLabel} />
          <span className={cn("font-mono text-[11px] text-muted-foreground", collapsibleLabel)}>
            v{packageJson.version}
          </span>
        </div>
      </div>
    </aside>
  );
}
