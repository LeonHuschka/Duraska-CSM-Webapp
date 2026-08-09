import { getActivePersonaId } from "@/lib/persona";
import { ScreenshotTest } from "@/components/settings/screenshot-test";

// Reading a screenshot is one Vision call, and the last stage may add a
// second. Ten seconds — the default — is not enough for either.
export const maxDuration = 60;

export default async function ScreenshotTestPage() {
  const personaId = await getActivePersonaId();
  if (!personaId) {
    return <p className="text-muted-foreground">Select a persona first.</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Screenshot check</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Runs an image through the same steps the bot does: read the tiles,
          cut each one out, and identify it against the vault. Use it whenever
          a VA changes what they screenshot — nothing here assumes a layout,
          but that only helps if it has actually been tried.
        </p>
      </div>
      <ScreenshotTest />
    </div>
  );
}
