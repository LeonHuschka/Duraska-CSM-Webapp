"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createPersonaSchema,
  type CreatePersonaFormData,
} from "@/lib/validations/persona";

export async function createPersona(data: CreatePersonaFormData) {
  const parsed = createPersonaSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: persona, error: insertError } = await supabase
    .from("personas")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      brand_color: parsed.data.brand_color,
      platforms: parsed.data.platforms,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: "A persona with this slug already exists" };
    }
    return { error: insertError.message };
  }

  const { error: memberError } = await supabase
    .from("persona_members")
    .insert({
      persona_id: persona.id,
      user_id: user.id,
      role: "owner",
    });

  if (memberError) {
    return { error: memberError.message };
  }

  revalidatePath("/", "layout");
  return { error: null, personaId: persona.id };
}

export async function updatePersona(
  personaId: string,
  data: Partial<CreatePersonaFormData>
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("personas")
    .update({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.slug !== undefined && { slug: data.slug }),
      ...(data.brand_color !== undefined && { brand_color: data.brand_color }),
      ...(data.platforms !== undefined && { platforms: data.platforms }),
    })
    .eq("id", personaId);

  if (error) {
    if (error.code === "23505") {
      return { error: "A persona with this slug already exists" };
    }
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  return { error: null };
}

export async function inviteMember(
  personaId: string,
  email: string,
  role: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Look up user by email via user_profiles + auth
  // We need to find the user's ID from their email
  const { data: authUsers, error: lookupError } = await supabase
    .rpc("get_user_id_by_email", { email_input: email }) as { data: string | null; error: { message: string } | null };

  // Fallback: query user_profiles if the RPC doesn't exist yet
  // In practice, looking up by email requires a server-side approach
  // For now, we'll use a workaround: query auth.users is not possible from client
  // So we search persona_members for existing membership
  if (lookupError || !authUsers) {
    return {
      error:
        "Could not find a user with that email. They must sign up first.",
    };
  }

  const targetUserId = authUsers as string;

  const { error: insertError } = await supabase
    .from("persona_members")
    .insert({
      persona_id: personaId,
      user_id: targetUserId,
      role,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: "This user is already a member of this persona" };
    }
    return { error: insertError.message };
  }

  revalidatePath("/settings/personas");
  return { error: null };
}

export async function updateMemberRole(
  personaId: string,
  userId: string,
  newRole: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("persona_members")
    .update({ role: newRole })
    .eq("persona_id", personaId)
    .eq("user_id", userId);

  if (error) return { error: error.message };

  revalidatePath("/settings/personas");
  return { error: null };
}

export async function removeMember(personaId: string, userId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  if (userId === user.id) {
    return { error: "You cannot remove yourself" };
  }

  const { error } = await supabase
    .from("persona_members")
    .delete()
    .eq("persona_id", personaId)
    .eq("user_id", userId);

  if (error) return { error: error.message };

  revalidatePath("/settings/personas");
  return { error: null };
}
