"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu } from "lucide-react";
import { SignOut } from "@/components/auth/sign-out";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { appVersion } from "@/lib/app-version";
import { NavList } from "./nav-list";
import { ThemeToggle } from "./theme-toggle";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar px-4 md:hidden">
      <Link href="/" className="flex items-center gap-2.5">
        <Image src="/logo.svg" alt="" width={28} height={28} className="size-7 rounded-md" />
        <span className="text-[15px] font-semibold tracking-tight">RundfunkArr</span>
      </Link>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Menü öffnen">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
          <SheetHeader className="h-16 justify-center border-b border-sidebar-border px-4 text-left">
            <SheetTitle className="flex items-center gap-3 text-[15px]">
              <Image src="/logo.svg" alt="" width={32} height={32} className="size-8 rounded-lg" />
              RundfunkArr
            </SheetTitle>
            <SheetDescription className="sr-only">Hauptnavigation</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <NavList onNavigate={() => setOpen(false)} />
          </div>
          <div className="space-y-2 border-t border-sidebar-border px-3 py-3">
            <SignOut />
            <div className="flex items-center justify-between gap-2">
              <ThemeToggle />
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                {appVersion}
              </span>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
