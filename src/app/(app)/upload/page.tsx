import { cookies } from "next/headers";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { UploadView } from "@/components/upload/upload-view";

export default async function UploadPage() {
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Select a persona to upload.</p>
      </div>
    );
  }

  return <UploadView personaId={personaId} />;
}
