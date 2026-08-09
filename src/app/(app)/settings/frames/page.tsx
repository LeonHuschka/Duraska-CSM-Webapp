import { getActivePersonaId } from "@/lib/persona";
import { FramesBackfill } from "@/components/settings/frames-backfill";
import { framesProgress } from "./actions";

export default async function FramesPage() {
  const personaId = await getActivePersonaId();
  if (!personaId) {
    return <p className="text-muted-foreground">Select a persona first.</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Stills</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          A grid tile is a frame of one of our videos — almost never the frame
          the thumbnail was cut from, and usually cropped to a different shape.
          Recognising it needs several stills per cut rather than one picture.
          New cuts get theirs on upload; this fills in the ones already in the
          vault, and downloads each video once to do it.
        </p>
      </div>
      <FramesBackfill initial={await framesProgress()} />
    </div>
  );
}
