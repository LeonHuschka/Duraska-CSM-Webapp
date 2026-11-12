"use client";

import { useTransition } from "react";
import { LogOut, User as UserIcon } from "lucide-react";
import { signOut } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import Image from "next/image";
import { MobileSidebar } from "./mobile-sidebar";
import { TopNav } from "./top-nav";

interface TopBarProps {
  userEmail: string;
  userName: string | null;
  /** The model has no persona to switch between — hide the sidebar trigger. */
  isModel?: boolean;
  /** The section pills need a persona; without one there is nothing to open. */
  withNav?: boolean;
}

export function TopBar({ userEmail, userName, isModel = false, withNav = false }: TopBarProps) {
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(() => {
      signOut();
    });
  }

  const initials =
    userName
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? userEmail.charAt(0).toUpperCase();

  return (
    <header className="relative flex h-16 shrink-0 items-center justify-between px-4 md:h-[72px] md:px-5">
      {/* Mobile: hamburger + logo. The hamburger opens the slide-in sidebar,
          which is the ONLY place the persona switcher lives on a phone. */}
      <div className="flex items-center gap-2 md:hidden">
        {!isModel && <MobileSidebar />}
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Duraska
        </span>
      </div>
      {/* Desktop: the logo as a round glass button, the sections as pills in the middle. */}
      <Link href="/" className="glass-pill hidden h-14 w-14 items-center justify-center overflow-hidden rounded-full md:flex">
        <Image src="/Duraska_logo_white.svg" alt="Duraska" width={84} height={84} className="h-[84px] w-[84px] max-w-none" />
      </Link>
      {withNav && (
        <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block">
          <TopNav />
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="glass-pill h-10 gap-2.5 rounded-full px-1.5 pr-3.5 hover:bg-white/20">
            <Avatar className="h-7 w-7 ring-2 ring-white/30">
              <AvatarFallback className="bg-gradient-to-br from-amber-300 to-orange-500 text-xs font-semibold text-neutral-900">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium sm:inline-block md:hidden xl:inline-block">
              {userName ?? userEmail}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{userName ?? "User"}</p>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2" disabled>
            <UserIcon className="h-4 w-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-destructive focus:text-destructive"
            onSelect={handleSignOut}
            disabled={isPending}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
