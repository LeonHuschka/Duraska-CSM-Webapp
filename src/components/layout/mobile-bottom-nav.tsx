"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Settings,
  Camera,
  Archive,
  Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersona } from "@/hooks/use-persona";

// Dashboard + Overview omitted from mobile (sidebar-only) to keep 5 items max.
const allNavItems = [
  { href: "/produce", label: "Requests", icon: Camera, roles: ["owner", "manager", "va", "model"] },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, roles: ["owner", "manager", "va"] },
  { href: "/warmup", label: "Warm-Up", icon: Flame, roles: ["owner", "manager", "va", "model"] },
  { href: "/vault", label: "Vault", icon: Archive, roles: ["owner", "manager", "va", "model"] },
  { href: "/settings/personas", label: "Settings", icon: Settings, roles: ["owner", "manager"] },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { activePersona } = usePersona();
  const role = activePersona.role;

  const navItems = allNavItems.filter((item) => item.roles.includes(role));

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-card/95 backdrop-blur-md">
      <div className="flex items-center justify-around h-16 px-2 safe-area-pb">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-150 min-w-[52px]",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
              <span className={cn(
                "text-[10px] font-medium leading-none",
                isActive ? "text-primary" : "text-muted-foreground"
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
