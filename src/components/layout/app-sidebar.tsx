"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Kanban,
  CalendarDays,
  Settings,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonaSwitcher } from "./persona-switcher";
import { usePersona } from "@/hooks/use-persona";

const allNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "manager", "va"] },
  { href: "/produce", label: "Requests", icon: Camera, roles: ["owner", "manager", "va", "model"] },
  { href: "/requests", label: "Overview", icon: Kanban, roles: ["owner", "manager", "va"] },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, roles: ["owner", "manager", "va"] },
  { href: "/settings/personas", label: "Settings", icon: Settings, roles: ["owner", "manager"] },
];

interface AppSidebarProps {
  onNavigate?: () => void;
}

export function AppSidebar({ onNavigate }: AppSidebarProps) {
  const pathname = usePathname();
  const { activePersona } = usePersona();
  const role = activePersona.role;

  const navItems = allNavItems.filter((item) => item.roles.includes(role));

  return (
    <aside className="flex h-full w-full flex-col">
      <div className="flex items-center justify-center px-5 py-5">
        <Image
          src="/Duraska_logo_white.svg"
          alt="Duraska"
          width={180}
          height={180}
          className="h-[180px] w-[180px]"
        />
      </div>

      <div className="px-3 pb-4">
        <PersonaSwitcher />
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon className={cn("h-4 w-4", isActive && "text-primary")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
