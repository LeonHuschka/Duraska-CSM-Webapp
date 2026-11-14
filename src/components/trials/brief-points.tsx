import { briefPoints } from "@/lib/brief-points";

/**
 * The brief laid out like the SHOOTING list in Telegram: "👉 Outfit 1",
 * then a bullet per point. A point that starts with a label in capitals
 * ("HOOK: …") shows the label bold.
 */
export function BriefPoints({ name, brief, compact = false }: { name: string; brief: string; compact?: boolean }) {
  const points = briefPoints(brief);
  return (
    <div className={compact ? "rounded-lg border border-primary/40 bg-primary/10 p-2.5" : "rounded-xl border border-primary/40 bg-primary/10 p-3"}>
      <p className="text-sm font-semibold">👉 {name}</p>
      <ul className="mt-1.5 space-y-1">
        {points.map((pt, i) => {
          const m = pt.match(/^([A-ZÄÖÜ][A-ZÄÖÜ0-9 &/-]{1,24}):\s*(.*)$/);
          return (
            <li key={i} className="flex gap-2 text-sm leading-snug">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>
                {m ? (
                  <>
                    <b className="font-semibold">{m[1]}:</b> {m[2]}
                  </>
                ) : (
                  pt
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
