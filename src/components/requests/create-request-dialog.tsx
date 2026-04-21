"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  createRequest,
  createContentType,
  renameContentType,
  deleteContentType,
  seedDefaultContentTypes,
} from "@/app/(app)/requests/actions";
import type { ContentType } from "@/lib/types/database";

interface FormValues {
  content_type_id: string;
  description: string;
  priority: string;
  due_date: string;
  inspo_link: string;
  is_nsfw: boolean;
}

interface CreateRequestDialogProps {
  contentTypes: ContentType[];
}

export function CreateRequestDialog({
  contentTypes: initialTypes,
}: CreateRequestDialogProps) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState(initialTypes);
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      content_type_id: "",
      description: "",
      priority: "medium",
      due_date: "",
      inspo_link: "",
      is_nsfw: false,
    },
  });

  const selectedTypeId = watch("content_type_id");

  const handleSeedDefaults = async () => {
    try {
      await seedDefaultContentTypes();
      const { getContentTypes } = await import(
        "@/app/(app)/requests/actions"
      );
      const updated = await getContentTypes();
      setTypes(updated);
      toast.success("Default content types created");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create defaults"
      );
    }
  };

  const handleAddType = async () => {
    if (!newTypeName.trim()) return;
    try {
      const created = await createContentType(newTypeName.trim());
      setTypes((prev) => [...prev, created]);
      setNewTypeName("");
      setAddingType(false);
      setValue("content_type_id", created.id);
      toast.success(`"${created.name}" added`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add type"
      );
    }
  };

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) return;
    try {
      await renameContentType(id, renameValue.trim());
      setTypes((prev) =>
        prev.map((t) => (t.id === id ? { ...t, name: renameValue.trim() } : t))
      );
      setRenamingId(null);
      toast.success("Renamed");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to rename"
      );
    }
  };

  const handleDeleteType = async (id: string) => {
    try {
      await deleteContentType(id);
      setTypes((prev) => prev.filter((t) => t.id !== id));
      if (selectedTypeId === id) setValue("content_type_id", "");
      toast.success("Type deleted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete type"
      );
    }
  };

  const onSubmit = async (values: FormValues) => {
    try {
      await createRequest({
        content_type_id: values.content_type_id,
        description: values.description || undefined,
        priority: values.priority,
        due_date: values.due_date || undefined,
        inspo_link: values.inspo_link || undefined,
        is_nsfw: values.is_nsfw,
      });
      toast.success("Request created");
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create request"
      );
    }
  };

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Request
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Content Request</DialogTitle>
          <DialogDescription>
            Create a new content request for your pipeline.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Content Type (Art) */}
          <div className="space-y-2">
            <Label>Art</Label>
            {types.length === 0 && !addingType ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/50 p-4">
                <p className="text-xs text-muted-foreground">
                  No content types yet
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSeedDefaults}
                  >
                    Add defaults
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddingType(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Custom
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select
                  value={selectedTypeId}
                  onValueChange={(val) => setValue("content_type_id", val)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((type) => (
                      <div key={type.id} className="flex items-center">
                        {renamingId === type.id ? (
                          <div className="flex w-full items-center gap-1 px-2 py-1.5">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              className="h-7 text-xs"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleRename(type.id);
                                }
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleRename(type.id)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <SelectItem
                            value={type.id}
                            className="flex-1 pr-8"
                          >
                            {type.name}
                          </SelectItem>
                        )}
                      </div>
                    ))}
                  </SelectContent>
                </Select>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => setAddingType(true)}>
                      <Plus className="h-4 w-4" />
                      Add new type
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {types.map((type) => (
                      <div key={type.id} className="flex items-center">
                        <DropdownMenuItem
                          className="flex-1"
                          onClick={() => {
                            setRenamingId(type.id);
                            setRenameValue(type.name);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Rename &ldquo;{type.name}&rdquo;
                        </DropdownMenuItem>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteType(type.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {addingType && (
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Dance, Tutorial..."
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddType();
                    }
                    if (e.key === "Escape") {
                      setAddingType(false);
                      setNewTypeName("");
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddType}
                >
                  Add
                </Button>
              </div>
            )}

            <input
              type="hidden"
              {...register("content_type_id", {
                required: "Select a content type",
              })}
            />
            {errors.content_type_id && (
              <p className="text-xs text-destructive">
                {errors.content_type_id.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe the content needed..."
              rows={3}
              {...register("description")}
            />
          </div>

          {/* Inspo Link */}
          <div className="space-y-2">
            <Label htmlFor="inspo_link">
              <span className="flex items-center gap-1.5">
                <LinkIcon className="h-3.5 w-3.5" />
                Inspo Link
                <span className="text-muted-foreground font-normal">(optional)</span>
              </span>
            </Label>
            <Input
              id="inspo_link"
              placeholder="https://..."
              {...register("inspo_link")}
            />
          </div>

          {/* NSFW toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div>
              <Label className="text-sm">NSFW Content</Label>
              <p className="text-[11px] text-muted-foreground">NSFW = Fansly only. SFW = Fansly + Instagram</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={watch("is_nsfw")}
              onClick={() => setValue("is_nsfw", !watch("is_nsfw"))}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                watch("is_nsfw") ? "bg-blue-500" : "bg-muted-foreground/30"
              }`}
            >
              <span
                className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  watch("is_nsfw") ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Effort */}
            <div className="space-y-2">
              <Label>Effort</Label>
              <Select
                defaultValue="medium"
                onValueChange={(val) => setValue("priority", val)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="heavy">Heavy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Due Date */}
            <div className="space-y-2">
              <Label htmlFor="due_date">Due Date</Label>
              <Input
                id="due_date"
                type="date"
                {...register("due_date", { required: "Due date is required" })}
              />
              {errors.due_date && (
                <p className="text-xs text-destructive">
                  {errors.due_date.message}
                </p>
              )}
            </div>
          </div>

          {/* Created at (auto) */}
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Created</Label>
            <p className="text-sm">{today}</p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
