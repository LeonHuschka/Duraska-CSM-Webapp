import { z } from "zod";

export const createPersonaSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(50)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    ),
  brand_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color"),
  platforms: z.array(z.enum(["instagram", "fansly", "tiktok", "other"])),
});

export const updatePersonaSchema = createPersonaSchema.partial().extend({
  id: z.string().uuid(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["owner", "manager", "model", "va"]),
});

export type CreatePersonaFormData = z.infer<typeof createPersonaSchema>;
export type UpdatePersonaFormData = z.infer<typeof updatePersonaSchema>;
export type InviteMemberFormData = z.infer<typeof inviteMemberSchema>;
