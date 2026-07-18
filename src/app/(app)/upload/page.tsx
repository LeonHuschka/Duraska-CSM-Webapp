import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";
import { UploadView } from "@/components/upload/upload-view";

export default async function UploadPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const personaId = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  if (!personaId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Select a persona to upload.</p>
      </div>
    );
  }

  const { data: types } = await supabase
    .from("content_types")
    .select("id, name")
    .eq("persona_id", personaId)
    .order("position", { ascending: true });

  return (
    <UploadView
      personaId={personaId}
      contentTypes={(types ?? []) as { id: string; name: string }[]}
    />
  );
}
