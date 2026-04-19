"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { Persona } from "@/lib/types/database";
import {
  createPersonaSchema,
  type CreatePersonaFormData,
} from "@/lib/validations/persona";
import { updatePersona } from "@/app/(app)/settings/personas/actions";
import { PLATFORMS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface PersonaSettingsFormProps {
  persona: Persona;
  canEdit: boolean;
}

export function PersonaSettingsForm({
  persona,
  canEdit,
}: PersonaSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const currentPlatforms = Array.isArray(persona.platforms)
    ? (persona.platforms as string[])
    : [];

  const form = useForm<CreatePersonaFormData>({
    resolver: zodResolver(createPersonaSchema),
    defaultValues: {
      name: persona.name,
      slug: persona.slug,
      brand_color: persona.brand_color,
      platforms: currentPlatforms as CreatePersonaFormData["platforms"],
    },
  });

  async function onSubmit(data: CreatePersonaFormData) {
    startTransition(async () => {
      const result = await updatePersona(persona.id, data);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Persona updated");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Persona Details</CardTitle>
        <CardDescription>
          {canEdit
            ? "Update your persona's profile and settings."
            : "You don't have permission to edit these settings."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                disabled={!canEdit}
                {...form.register("name")}
              />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                disabled={!canEdit}
                {...form.register("slug")}
              />
              {form.formState.errors.slug && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.slug.message}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-color">Brand Color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                id="brand-color"
                className="h-9 w-9 cursor-pointer rounded border p-0.5"
                value={form.watch("brand_color")}
                onChange={(e) => form.setValue("brand_color", e.target.value)}
                disabled={!canEdit}
              />
              <Input
                className="max-w-32"
                disabled={!canEdit}
                {...form.register("brand_color")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-3">
              {PLATFORMS.map((platform) => {
                const checked = form.watch("platforms")?.includes(platform);
                return (
                  <label
                    key={platform}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canEdit}
                      onChange={(e) => {
                        const current = form.getValues("platforms") ?? [];
                        if (e.target.checked) {
                          form.setValue("platforms", [...current, platform]);
                        } else {
                          form.setValue(
                            "platforms",
                            current.filter((p) => p !== platform)
                          );
                        }
                      }}
                      className="rounded border-input"
                    />
                    <span className="capitalize">{platform}</span>
                  </label>
                );
              })}
            </div>
          </div>
          {canEdit && (
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
