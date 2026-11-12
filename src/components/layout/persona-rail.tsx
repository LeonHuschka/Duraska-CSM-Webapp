"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Workflow, Users, Link2 } from "lucide-react";
import { switchPersona } from "@/app/(app)/actions";
import { usePersona } from "@/hooks/use-persona";
import { cn } from "@/lib/utils";

/**
 * The floating rail on the left: one round button per persona, then the
 * dashboard's three views. The open one is white; hovering names it.
 */
const VIEWS = [
  { key: "pipeline", label: "Pipeline", icon: Workflow, href: "/" },
  { key: "accounts", label: "Accounts", icon: Users, href: "/?tab=accounts" },
  { key: "link", label: "Link", icon: Link2, href: "/?tab=link" },
];
const ITEM = "group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all duration-200";
const ON = "bg-white text-neutral-900 shadow-[0_6px_18px_-4px_rgba(255,255,255,0.5)]";
const OFF = "text-white/80 hover:bg-white/20 hover:text-white";
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="glass-pill pointer-events-none absolute left-full ml-4 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
      {children}
    </span>
  );
}
export function PersonaRail() {
  const { activePersona, personas } = usePersona();
  const [pending, start] = useTransition();
  const pathname = usePathname();
  const tab = useSearchParams().get("tab") ?? "pipeline";
  if (activePersona.role === "model" || personas.length === 0) return null;
  return (
    <aside className="glass-rail fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center gap-2 rounded-full p-2 md:flex">
      {personas.map((p) => {
        const active = p.id === activePersona.id;
        return (
          <button
            key={p.id}
            type="button"
            disabled={pending}
            onClick={() => !active && start(() => switchPersona(p.id))}
            className={cn(ITEM, active ? ON : OFF)}
          >
            {p.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatar_url} alt="" className={cn("h-8 w-8 rounded-full object-cover", active && "ring-2 ring-neutral-900/10")} />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full" style={active ? undefined : { backgroundColor: `${p.brand_color}55` }}>
                {p.name.charAt(0).toUpperCase()}
              </span>
            )}
            <Tip>{p.name}</Tip>
          </button>
        );
      })}
      <span className="my-1 h-px w-6 bg-white/20" />
      {VIEWS.map((v) => {
        const active = pathname === "/" && tab === v.key;
        return (
          <Link key={v.key} href={v.href} scroll={false} className={cn(ITEM, active ? ON : OFF)}>
            <v.icon className="h-[18px] w-[18px]" />
            <Tip>{v.label}</Tip>
          </Link>
        );
      })}
    </aside>
  );
}
