"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSlowBound } from "@/components/pipeline/actions";

/**
 * The slow end of a gauge, editable where it is read.
 *
 * Deliberately not a form: it looks like the label it replaces until you
 * click it, saves on blur or Enter, and refreshes the page so the marker
 * moves against the new scale immediately.
 */
export function SlowBoundInput({
  legKey,
  value,
}: {
  legKey: "inspo" | "edit" | "post";
  value: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [pending, start] = useTransition();
  const router = useRouter();

  function commit() {
    setEditing(false);
    const n = Number(draft);
    if (!Number.isFinite(n) || n <= 0 || n === value) {
      setDraft(String(value));
      return;
    }
    start(async () => {
      const res = await setSlowBound(legKey, n);
      if (res.error) setDraft(String(value));
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="How slow this leg should ever get — click to change"
        className="rounded px-1 -mx-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        {pending ? "…" : `${draft}d`}
      </button>
    );
  }

  return (
    <input
      type="number"
      min={1}
      max={365}
      step={1}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(String(value));
          setEditing(false);
        }
      }}
      className="w-10 rounded border border-border bg-background px-1 text-center text-[10px] tabular-nums outline-none focus:border-primary"
    />
  );
}
