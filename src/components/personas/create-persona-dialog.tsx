"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  createPersonaSchema,
  type CreatePersonaFormData,
} from "@/lib/validations/persona";
import { createPersona } from "@/app/(app)/settings/personas/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CreatePersonaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CreatePersonaDialog({
  open,
  onOpenChange,
}: CreatePersonaDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<CreatePersonaFormData>({
    resolver: zodResolver(createPersonaSchema),
    defaultValues: {
      name: "",
      slug: "",
      brand_color: "#6366f1",
      platforms: [],
    },
  });

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const name = e.target.value;
    form.setValue("name", name);
    if (!form.getValues("slug") || slugify(form.getValues("name")) === form.getValues("slug")) {
      form.setValue("slug", slugify(name));
    }
  }

  async function onSubmit(data: CreatePersonaFormData) {
    startTransition(async () => {
      const result = await createPersona(data);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Persona "${data.name}" created`);
      onOpenChange(false);
      form.reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Persona</DialogTitle>
          <DialogDescription>
            A persona represents an AI character. You&apos;ll manage content and
            scheduling per persona.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="persona-name">Name</Label>
            <Input
              id="persona-name"
              placeholder="e.g. Mila"
              {...form.register("name")}
              onChange={handleNameChange}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="persona-slug">Slug</Label>
            <Input
              id="persona-slug"
              placeholder="e.g. mila"
              {...form.register("slug")}
            />
            {form.formState.errors.slug && (
              <p className="text-xs text-destructive">
                {form.formState.errors.slug.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="persona-color">Brand Color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                id="persona-color"
                className="h-9 w-9 cursor-pointer rounded border p-0.5"
                value={form.watch("brand_color")}
                onChange={(e) => form.setValue("brand_color", e.target.value)}
              />
              <Input
                className="flex-1"
                {...form.register("brand_color")}
                placeholder="#6366f1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create Persona"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
