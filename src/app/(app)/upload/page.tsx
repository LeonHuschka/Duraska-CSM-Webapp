import { getActivePersonaId } from "@/lib/persona";
import { UploadView } from "@/components/upload/upload-view";

export default async function UploadPage() {
  const personaId = await getActivePersonaId();

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Select a persona to upload.</p>
      </div>
    );
  }

  return <UploadView personaId={personaId} />;
}
