export default function PersonaSettingsLoading() {
  return (
    <div className="space-y-8">
      <div className="rounded-lg border p-6">
        <div className="space-y-4">
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded bg-muted" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
      <div className="rounded-lg border p-6">
        <div className="space-y-4">
          <div className="h-6 w-32 animate-pulse rounded bg-muted" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
