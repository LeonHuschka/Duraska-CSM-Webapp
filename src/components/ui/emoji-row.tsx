"use client";

import { useState, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * Emojis a tap away under a caption box. The macOS picker (ctrl+cmd+space)
 * does not reliably land in a box inside a dialog, so the common ones are
 * here, and "More" opens the rest. Inserts where the cursor is.
 */
const QUICK = ["👅", "💦", "🔥", "👀", "😈", "🍑", "💋", "🥵", "😏", "🫦", "🤤", "❤️"];
const MORE = [
  "😍", "🥰", "😘", "😉", "😜", "🤭", "🙈", "😳", "🥺", "😩", "😮‍💨", "🤫",
  "😇", "👻", "💀", "🤍", "🖤", "💕", "💗", "💖", "✨", "🌶️", "🍒", "🍆",
  "🍌", "🍓", "🍯", "🧁", "🎀", "👙", "👠", "💄", "💅", "🛁", "🛏️", "🚿",
  "📱", "💌", "🎁", "🎃", "🌙", "☀️", "⬇️", "👇", "👉", "🙏", "👏", "💯",
];

export function EmojiRow({
  target,
  value,
  onChange,
  max = 3000,
  disabled = false,
  className,
}: {
  target: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  max?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [more, setMore] = useState(false);
  if (disabled) return null;

  const insert = (text: string) => {
    const el = target.current;
    const at = el ? el.selectionStart : value.length;
    const to = el ? el.selectionEnd : value.length;
    onChange((value.slice(0, at) + text + value.slice(to)).slice(0, max));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(at + text.length, at + text.length);
    });
  };
  const button = (e: string) => (
    <button
      key={e}
      type="button"
      onClick={() => insert(e)}
      className="flex h-8 w-8 items-center justify-center rounded-full text-base transition-colors hover:bg-white/10"
      title={`Add ${e}`}
    >
      {e}
    </button>
  );

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-center gap-0.5">
        {QUICK.map(button)}
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          className="ml-1 rounded-full px-2 py-1 text-[11px] font-medium text-white/55 hover:bg-white/10 hover:text-white"
        >
          {more ? "Less" : "More"}
        </button>
      </div>
      {more && <div className="flex flex-wrap gap-0.5 rounded-xl border border-white/10 bg-white/[0.04] p-1">{MORE.map(button)}</div>}
    </div>
  );
}
