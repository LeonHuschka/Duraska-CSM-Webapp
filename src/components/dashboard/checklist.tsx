"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ListChecks, Pencil, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  addChecklistItem,
  deleteChecklistItem,
  editChecklistItem,
  setChecklistRepeat,
  toggleChecklistItem,
} from "@/components/dashboard/checklist-actions";
import { REPEATS, type RepeatKey } from "@/lib/checklist";

export type ChecklistEntry = { id: string; text: string; done: boolean; repeat: RepeatKey };

function RepeatSelect({ value, onChange }: { value: RepeatKey; onChange: (r: RepeatKey) => void }) {
  return (
    <select
      value={value}
      onChange={(ev) => onChange(ev.target.value as RepeatKey)}
      className="h-7 shrink-0 self-center rounded-md border border-border/50 bg-card px-1.5 text-[11px]"
      aria-label="Repeats"
    >
      {REPEATS.map((r) => (
        <option key={r.key} value={r.key}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The model's to-do list on her dashboard: boxes she ticks. Owners and
 * managers, looking at her dashboard, write, change and remove entries.
 * Open entries first, in the order they were written; ticked ones below.
 * A tick holds for the entry's repeat (1d, 7d, 30d or all time), then the
 * box is open again.
 */
export function Checklist({ items, canEdit }: { items: ChecklistEntry[]; canEdit: boolean }) {
  const router = useRouter();
  const [list, setList] = useState(items);
  const [draft, setDraft] = useState("");
  const [draftRepeat, setDraftRepeat] = useState<RepeatKey>("1d");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [, start] = useTransition();
  useEffect(() => setList(items), [items]);

  const run = (fn: () => Promise<{ error: string | null }>, undo?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) {
        undo?.();
        toast.error(res.error);
      }
      router.refresh();
    });

  const toggle = (e: ChecklistEntry) => {
    const before = list;
    setList((l) => l.map((x) => (x.id === e.id ? { ...x, done: !x.done } : x)));
    run(() => toggleChecklistItem(e.id, !e.done), () => setList(before));
  };
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setList((l) => [...l, { id: `new-${Date.now()}`, text, done: false, repeat: draftRepeat }]);
    run(() => addChecklistItem(text, draftRepeat));
  };
  const save = (id: string) => {
    const text = editText.trim();
    setEditing(null);
    if (!text) return;
    setList((l) => l.map((x) => (x.id === id ? { ...x, text } : x)));
    run(() => editChecklistItem(id, text));
  };
  const repeat = (id: string, r: RepeatKey) => {
    const before = list;
    setList((l) => l.map((x) => (x.id === id ? { ...x, repeat: r } : x)));
    run(() => setChecklistRepeat(id, r), () => setList(before));
  };
  const remove = (id: string) => {
    const before = list;
    setList((l) => l.filter((x) => x.id !== id));
    run(() => deleteChecklistItem(id), () => setList(before));
  };

  if (list.length === 0 && !canEdit) return null;
  const open = list.filter((x) => !x.done);
  const done = list.filter((x) => x.done);

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <ListChecks className="h-4 w-4 text-muted-foreground" /> Checklist
        </h2>
        {list.length > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {done.length}/{list.length} done
          </span>
        )}
      </div>

      <ul className="mt-3 space-y-1">
        {[...open, ...done].map((e) => (
          <li key={e.id} className="group flex items-start gap-3 rounded-xl px-1 py-1.5">
            <button
              type="button"
              onClick={() => toggle(e)}
              disabled={e.id.startsWith("new-")}
              aria-label={e.done ? "Mark as not done" : "Mark as done"}
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors ${
                e.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-border hover:border-foreground/60"
              }`}
            >
              {e.done && <Check className="h-4 w-4" strokeWidth={3} />}
            </button>
            {editing === e.id ? (
              <Input
                autoFocus
                value={editText}
                onChange={(ev) => setEditText(ev.target.value)}
                onBlur={() => save(e.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") save(e.id);
                  if (ev.key === "Escape") setEditing(null);
                }}
                className="h-8 text-sm"
              />
            ) : (
              <span
                className={`min-w-0 flex-1 pt-0.5 text-sm leading-snug ${
                  e.done ? "text-muted-foreground line-through" : ""
                }`}
              >
                {e.text}
                {!canEdit && e.repeat !== "all" && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{e.repeat}</span>
                )}
              </span>
            )}
            {canEdit && editing !== e.id && !e.id.startsWith("new-") && (
              <span className="flex shrink-0 items-center gap-0.5">
                <RepeatSelect value={e.repeat} onChange={(r) => repeat(e.id, r)} />
                <button
                  type="button"
                  onClick={() => {
                    setEditing(e.id);
                    setEditText(e.text);
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(e.id)}
                  className="rounded p-1 text-muted-foreground hover:text-rose-400"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {list.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Nothing on the list yet — add what she should do.</p>
      )}

      {canEdit && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            add();
          }}
        >
          <Input
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            placeholder="Add an entry…"
            className="h-9 text-sm"
            maxLength={300}
          />
          <RepeatSelect value={draftRepeat} onChange={setDraftRepeat} />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
            aria-label="Add"
          >
            <Plus className="h-4 w-4" />
          </button>
        </form>
      )}
    </div>
  );
}
