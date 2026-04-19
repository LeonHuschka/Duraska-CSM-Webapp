"use client";

import { useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { switchPersona } from "@/app/(app)/actions";
import { usePersona } from "@/hooks/use-persona";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function PersonaSwitcher() {
  const { activePersona, personas } = usePersona();
  const [isPending, startTransition] = useTransition();

  function handleSwitch(personaId: string) {
    startTransition(() => {
      switchPersona(personaId);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between gap-2 border-border/50 bg-secondary/50 hover:bg-accent"
          disabled={isPending}
        >
          <div className="flex items-center gap-2.5 truncate">
            <div
              className="h-2.5 w-2.5 rounded-full ring-2 ring-background"
              style={{ backgroundColor: activePersona.brand_color }}
            />
            <span className="truncate text-sm font-medium">{activePersona.name}</span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[228px]">
        {personas.map((persona) => (
          <DropdownMenuItem
            key={persona.id}
            onSelect={() => handleSwitch(persona.id)}
            className="gap-2.5"
          >
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: persona.brand_color }}
            />
            <span className="flex-1 truncate">{persona.name}</span>
            {persona.id === activePersona.id && (
              <Check className="h-3.5 w-3.5 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
