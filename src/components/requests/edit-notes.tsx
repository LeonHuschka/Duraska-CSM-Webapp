"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import { saveEditNotes, type EditNote } from "@/app/(app)/requests/[id]/actions";

/**
 * Next to the inspo reel: what the editor should change or add on this
 * job, as boxes she ticks off. Anyone on the job can add, tick or remove.
 */
export function EditNotes({ requestId, initial }: { requestId: string; initial: EditNote[] }) {
  const [notes, setNotes] = useState<EditNote[]>(initial);
  const [draft, setDraft] = useState("");
  const [, start] = useTransition();

  const save = (next: EditNote[]) => {
    const before = notes;
    setNotes(next);
    start(async () => {
      const res = await saveEditNotes(requestId, next);
      if (res.error) {
        setNotes(before);
        toast.error(res.error);
      }
    });
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    save([...notes, { id: crypto.randomUUID(), text, done: false }]);
  };

  const done = notes.filter((n) => n.done).length;

  return (
    <div className="flex w-full flex-col rounded-xl border border-border/50 bg-card p-3 sm:w-72">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Edit notes</h3>
        {notes.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {done}/{notes.length} done
          </span>
        )}
      </div>
      {notes.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">What should the editor change or add?</p>
      )}
      <ul className="space-y-1">
        {notes.map((n) => (
          <li key={n.id} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-muted/30">
            <button
              type="button"
              onClick={() => save(notes.map((x) => (x.id === n.id ? { ...x, done: !x.done } : x)))}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                n.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/50"
              }`}
              aria-label={n.done ? "Mark as not done" : "Mark as done"}
            >
              {n.done && <Check className="h-3 w-3" />}
            </button>
            <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-sm ${n.done ? "text-muted-foreground line-through" : ""}`}>
              {n.text}
            </span>
            <button
              type="button"
              onClick={() => save(notes.filter((x) => x.id !== n.id))}
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
              aria-label="Remove"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a change…"
          className="h-8 min-w-0 flex-1 rounded-md border border-border/50 bg-background px-2 text-sm outline-none focus:border-primary/50"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/50 disabled:opacity-40"
          aria-label="Add"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
