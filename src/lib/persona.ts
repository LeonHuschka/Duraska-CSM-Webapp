import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_PERSONA_COOKIE } from "@/lib/constants";

/**
 * Resolve the active persona for the current user.
 *
 * The active-persona cookie is only ever written by the persona switcher,
 * which lives in the sidebar. On a phone the sidebar is hidden, so a user
 * who never opened the app on desktop has NO cookie at all — which used to
 * make every page render "Select a persona…" and every server action throw
 * "No active persona selected" (this is what blocked the model from
 * uploading).
 *
 * So: use the cookie when it points at a persona the user actually belongs
 * to, otherwise fall back to their first membership — the same fallback the
 * app layout already applies when rendering the shell.
 */
export async function getActivePersonaId(): Promise<string | null> {
  const cookieStore = await cookies();
  const saved = cookieStore.get(ACTIVE_PERSONA_COOKIE)?.value;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from("persona_members")
    .select("persona_id, role")
    .eq("user_id", user.id);

  const rows = memberships ?? [];
  if (rows.length === 0) return null;

  // A model IS her persona. Pin her to it regardless of cookie state or
  // membership ordering — she has no switcher to correct a wrong guess,
  // and she must never resolve to another model's persona.
  const ownModelPersona = rows.find((m) => m.role === "model");
  if (ownModelPersona) return ownModelPersona.persona_id;

  // Staff (owner / manager / va) can belong to several personas: honour the
  // cookie when it points at one of theirs, otherwise take the first.
  const ids = rows.map((m) => m.persona_id);
  if (saved && ids.includes(saved)) return saved;
  return ids[0];
}

/** Same as getActivePersonaId but throws — for server actions. */
export async function requireActivePersonaId(): Promise<string> {
  const id = await getActivePersonaId();
  if (!id) throw new Error("No active persona selected");
  return id;
}
