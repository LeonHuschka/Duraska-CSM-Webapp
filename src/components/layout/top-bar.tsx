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
import { MobileSidebar } from "./mobile-sidebar";

interface TopBarProps {
  userEmail: string;
  userName: string | null;
}

export function TopBar({ userEmail, userName }: TopBarProps) {
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
    <header className="flex h-14 items-center justify-between border-b border-border/50 px-4 md:justify-end md:px-6">
      <MobileSidebar />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2.5 rounded-full px-2 pr-3">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium sm:inline-block">
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
