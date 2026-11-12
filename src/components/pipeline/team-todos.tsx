"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RepeatKey } from "@/lib/checklist";
import {
  addTeamTodo,
  deleteTeamTodo,
  editTeamTodo,
  setTeamTodoRepeat,
  toggleTeamTodo,
} from "@/components/pipeline/team-todo-actions";

export type TeamTodo = { id: string; text: string; done: boolean; repeat: RepeatKey };

/** How often an entry comes back, and the colour of its edge. */
const REPEAT: Record<RepeatKey, { label: string; edge: string; chip: string }> = {
  "1d": { label: "Daily", edge: "border-l-blue-400", chip: "text-blue-300" },
  "7d": { label: "Weekly", edge: "border-l-amber-400", chip: "text-amber-300" },
  "30d": { label: "Monthly", edge: "border-l-violet-400", chip: "text-violet-300" },
  all: { label: "Once", edge: "border-l-emerald-400", chip: "text-emerald-300" },
};
const ORDER: RepeatKey[] = ["all", "1d", "7d", "30d"];

/**
 * The team's to-do, beside the chart as the day's list: a glass card of
 * entries, each edged in the colour of how often it comes back. Click the
 * chip to change that; open entries first, ticked ones faded below.
 */
export function TeamTodos({ items }: { items: TeamTodo[] }) {
  const router = useRouter();
  const [list, setList] = useState(items);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftRepeat, setDraftRepeat] = useState<RepeatKey>("all");
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

  const toggle = (e: TeamTodo) => {
    const before = list;
    setList((l) => l.map((x) => (x.id === e.id ? { ...x, done: !x.done } : x)));
    run(() => toggleTeamTodo(e.id, !e.done), () => setList(before));
  };
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setList((l) => [...l, { id: `new-${Date.now()}`, text, done: false, repeat: draftRepeat }]);
    run(() => addTeamTodo(text, draftRepeat));
  };
  const save = (id: string) => {
    const text = editText.trim();
    setEditing(null);
    if (!text) return;
    setList((l) => l.map((x) => (x.id === id ? { ...x, text } : x)));
    run(() => editTeamTodo(id, text));
  };
  const cycle = (e: TeamTodo) => {
    const next = ORDER[(ORDER.indexOf(e.repeat) + 1) % ORDER.length];
    const before = list;
    setList((l) => l.map((x) => (x.id === e.id ? { ...x, repeat: next } : x)));
    run(() => setTeamTodoRepeat(e.id, next), () => setList(before));
  };
  const remove = (id: string) => {
    const before = list;
    setList((l) => l.filter((x) => x.id !== id));
    run(() => deleteTeamTodo(id), () => setList(before));
  };

  const open = list.filter((x) => !x.done);
  const done = list.filter((x) => x.done);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

  return (
    <div className="flex h-full flex-col rounded-3xl border border-border/50 bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">To-do</h2>
          <p className="text-xs text-white/55">
            {today} · {open.length} open
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="glass-pill flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          aria-label="Add an entry"
        >
          <Plus className={cn("h-4 w-4 transition-transform", adding && "rotate-45")} />
        </button>
      </div>

      {adding && (
        <form
          className="mt-4 space-y-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            add();
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => ev.key === "Escape" && setAdding(false)}
            placeholder="What needs doing?"
            maxLength={300}
            className="h-10 w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 text-sm outline-none placeholder:text-white/40 focus:border-white/30"
          />
          <div className="flex items-center gap-1">
            {ORDER.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDraftRepeat(r)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  draftRepeat === r ? "bg-white text-neutral-900" : "text-white/60 hover:bg-white/10"
                )}
              >
                {REPEAT[r].label}
              </button>
            ))}
            <button
              type="submit"
              disabled={!draft.trim()}
              className="ml-auto rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </form>
      )}

      <ul className={cn("mt-4 space-y-2 overflow-y-auto", list.length > 0 && "flex-1")}>
        {[...open, ...done].map((e) => (
          <li
            key={e.id}
            className={cn(
              "group flex items-start gap-3 rounded-2xl border border-white/10 border-l-[3px] bg-white/[0.06] px-3 py-2.5 transition-opacity",
              REPEAT[e.repeat].edge,
              e.done && "opacity-45"
            )}
          >
            <button
              type="button"
              onClick={() => toggle(e)}
              disabled={e.id.startsWith("new-")}
              aria-label={e.done ? "Mark as not done" : "Mark as done"}
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                e.done ? "border-emerald-400 bg-emerald-400 text-neutral-900" : "border-white/40 hover:border-white"
              )}
            >
              {e.done && <Check className="h-3 w-3" strokeWidth={3} />}
            </button>
            <div className="min-w-0 flex-1">
              {editing === e.id ? (
                <input
                  autoFocus
                  value={editText}
                  onChange={(ev) => setEditText(ev.target.value)}
                  onBlur={() => save(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") save(e.id);
                    if (ev.key === "Escape") setEditing(null);
                  }}
                  className="h-7 w-full rounded-lg border border-white/20 bg-white/[0.06] px-2 text-sm outline-none"
                />
              ) : (
                <p className={cn("text-sm font-medium leading-snug", e.done && "line-through")}>{e.text}</p>
              )}
              <button
                type="button"
                onClick={() => cycle(e)}
                disabled={e.id.startsWith("new-")}
                className={cn("mt-0.5 text-[11px] font-medium", REPEAT[e.repeat].chip)}
                title="Change how often it comes back"
              >
                {REPEAT[e.repeat].label}
              </button>
            </div>
            {editing !== e.id && !e.id.startsWith("new-") && (
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(e.id);
                    setEditText(e.text);
                  }}
                  className="rounded-full p-1 text-white/50 hover:text-white"
                  aria-label="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(e.id)}
                  className="rounded-full p-1 text-white/50 hover:text-rose-300"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {list.length === 0 && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 rounded-2xl border border-dashed border-white/15 px-3 py-6 text-center text-xs text-white/50 hover:border-white/30 hover:text-white/80"
        >
          Nothing on the list. Add the first to-do.
        </button>
      )}
    </div>
  );
}
