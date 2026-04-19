"use client";

import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreatePersonaDialog } from "./create-persona-dialog";
import { useState } from "react";

export function CreatePersonaCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="max-w-md rounded-xl border border-border/50 bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          Create your first persona
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A persona represents an AI character or brand identity. All content
          requests and scheduling are scoped to a persona.
        </p>
        <Button
          onClick={() => setOpen(true)}
          className="mt-6 gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Persona
        </Button>
      </div>
      <CreatePersonaDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
