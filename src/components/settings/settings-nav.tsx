"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/settings/personas", label: "Personas", icon: Users },
  { href: "/settings/accounts", label: "Accounts", icon: AtSign },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-border/40 bg-card p-1">
      {items.map((it) => {
        const active = pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <it.icon className="h-3.5 w-3.5" />
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
