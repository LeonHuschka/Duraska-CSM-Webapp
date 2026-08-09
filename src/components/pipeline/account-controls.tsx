"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAccountPosting, setAccountManager } from "@/components/pipeline/actions";

/**
 * The two things about an account that only a person knows: how often it
 * posts right now, and who runs it.
 *
 * Edited on the card itself. The rate is not a preference — every stock and
 * runway figure in the app is divided by it — so it is shown as a value
 * with a unit, not hidden behind a settings page.
 */
export function AccountControls({
  accountId,
  perDay,
  manager,
  editable,
}: {
  accountId: string;
  perDay: number;
  manager: string | null;
  editable: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span>Managed by</span>
        {editable ? (
          <InlineText
            value={manager ?? ""}
            placeholder="nobody yet"
            width="w-32"
            onSave={(v) => setAccountManager(accountId, v)}
            render={(v) => (v ? `@${v}` : "nobody yet")}
          />
        ) : (
          <span className="text-foreground">
            {manager ? `@${manager}` : "nobody yet"}
          </span>
        )}
      </span>

      <span className="flex items-center gap-1.5">
        <span>Posts</span>
        {editable ? (
          <InlineText
            value={String(perDay)}
            numeric
            width="w-12"
            onSave={(v) => setAccountPosting(accountId, Number(v))}
            render={(v) => v}
          />
        ) : (
          <span className="text-foreground">{perDay}</span>
        )}
        <span>reels a day</span>
      </span>
    </div>
  );
}

function InlineText({
  value,
  placeholder,
  width,
  numeric = false,
  onSave,
  render,
}: {
  value: string;
  placeholder?: string;
  width: string;
  numeric?: boolean;
  onSave: (v: string) => Promise<{ error: string | null }>;
  render: (v: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, start] = useTransition();
  const router = useRouter();

  function commit() {
    setEditing(false);
    if (draft.trim() === value) return;
    if (numeric && !Number.isFinite(Number(draft))) {
      setDraft(value);
      return;
    }
    start(async () => {
      const res = await onSave(draft);
      if (res.error) setDraft(value);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded px-1 -mx-1 text-foreground underline decoration-dotted underline-offset-2 hover:text-primary"
      >
        {pending ? "…" : render(draft)}
      </button>
    );
  }

  return (
    <input
      type={numeric ? "number" : "text"}
      min={numeric ? 0 : undefined}
      max={numeric ? 50 : undefined}
      step={numeric ? 1 : undefined}
      autoFocus
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={`${width} rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary`}
    />
  );
}
