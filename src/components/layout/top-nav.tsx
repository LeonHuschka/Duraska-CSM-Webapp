"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Settings, Archive, Upload, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersona } from "@/hooks/use-persona";

/** The main sections, as glass pills across the top — the open one is white. */
const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "manager", "va", "model"] },
  { href: "/upload", label: "Upload", icon: Upload, roles: ["owner", "manager", "va", "model"] },
  { href: "/editing", label: "Editing", icon: Scissors, roles: ["owner", "manager", "va"] },
  { href: "/vault", label: "Vault", icon: Archive, roles: ["owner", "manager", "va", "model"] },
  { href: "/settings/personas", label: "Settings", icon: Settings, roles: ["owner", "manager"] },
];

export function TopNav() {
  const pathname = usePathname();
  const { activePersona } = usePersona();
  return (
    <nav className="flex items-center gap-2">
      {items
        .filter((i) => i.roles.includes(activePersona.role))
        .map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "glass-pill flex h-9 items-center gap-2 rounded-full px-3 lg:px-4 text-[13px] font-medium transition-all duration-200",
                active ? "glass-pill-active" : "text-white/80 hover:bg-white/20 hover:text-white"
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          );
        })}
    </nav>
  );
}
