"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Settings,
  Archive,
  Upload,
  Scissors,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersona } from "@/hooks/use-persona";

// The model gets Home, Upload and — since she posts on an account of her
// own — the Vault, where she downloads what she posts.
const allNavItems = [
  { href: "/", label: "Home", icon: LayoutDashboard, roles: ["owner", "manager", "va", "model"] },
  { href: "/upload", label: "Upload", icon: Upload, roles: ["owner", "manager", "va", "model"] },
  { href: "/editing", label: "Editing", icon: Scissors, roles: ["owner", "manager", "va"] },
  { href: "/vault", label: "Vault", icon: Archive, roles: ["owner", "manager", "va", "model"] },
  { href: "/settings/personas", label: "Settings", icon: Settings, roles: ["owner", "manager"] },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { activePersona } = usePersona();
  const role = activePersona.role;

  const navItems = allNavItems.filter((item) => item.roles.includes(role));

  return (
    <nav className="md:hidden fixed bottom-3 left-3 right-3 z-50 glass-rail rounded-3xl safe-area-pb">
      <div className="flex items-center justify-around h-16 px-2">
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
                "flex flex-col items-center gap-1 px-3 py-2 rounded-2xl transition-all duration-150 min-w-[52px]",
                isActive
                  ? "bg-white text-neutral-900"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
