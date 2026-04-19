export default function RequestsLoading() {
  const columns = Array.from({ length: 5 });
  const cards = [3, 2, 4, 1, 2];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-52 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
      </div>

      <div className="flex gap-4 overflow-hidden pb-4 -mx-6 px-6">
        {columns.map((_, colIdx) => (
          <div key={colIdx} className="w-72 min-w-[288px] shrink-0">
            <div className="mb-3 flex items-center gap-2.5 px-1">
              <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="ml-auto h-5 w-5 animate-pulse rounded bg-muted" />
            </div>

            <div className="flex flex-col gap-2.5 rounded-xl border border-border/30 bg-muted/30 p-2.5 min-h-[200px]">
              {Array.from({ length: cards[colIdx] }).map((_, cardIdx) => (
                <div
                  key={cardIdx}
                  className="rounded-xl border border-border/50 bg-card p-3.5"
                >
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="h-4 w-12 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
