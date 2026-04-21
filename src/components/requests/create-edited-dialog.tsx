"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  createEditedRequests,
  seedDefaultContentTypes,
  getContentTypes,
} from "@/app/(app)/requests/actions";
import type { ContentType } from "@/lib/types/database";

interface CreateEditedDialogProps {
  contentTypes: ContentType[];
}

export function CreateEditedDialog({
  contentTypes: initialTypes,
}: CreateEditedDialogProps) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState(initialTypes);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [count, setCount] = useState(1);
  const [effort, setEffort] = useState("medium");
  const [isNsfw, setIsNsfw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSeedDefaults = async () => {
    try {
      await seedDefaultContentTypes();
      const updated = await getContentTypes();
      setTypes(updated);
      toast.success("Default content types created");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create defaults"
      );
    }
  };

  const handleSubmit = async () => {
    if (!selectedTypeId) {
      toast.error("Select a content type");
      return;
    }
    if (count < 1 || count > 100) {
      toast.error("Count must be between 1 and 100");
      return;
    }

    setSubmitting(true);
    try {
      await createEditedRequests({
        content_type_id: selectedTypeId,
        count,
        priority: effort,
        is_nsfw: isNsfw,
      });
      const typeName = types.find((t) => t.id === selectedTypeId)?.name ?? "";
      toast.success(
        count === 1
          ? `${typeName} added to edited`
          : `${count}x ${typeName} added to edited`
      );
      setSelectedTypeId("");
      setCount(1);
      setEffort("medium");
      setIsNsfw(false);
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Edited Content</DialogTitle>
          <DialogDescription>
            Add content that was produced outside the pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Content Type */}
          <div className="space-y-2">
            <Label>Art</Label>
            {types.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/50 p-4">
                <p className="text-xs text-muted-foreground">
                  No content types yet
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSeedDefaults}
                >
                  Add defaults
                </Button>
              </div>
            ) : (
              <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {types.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Count */}
            <div className="space-y-2">
              <Label htmlFor="bulk-count">Count</Label>
              <Input
                id="bulk-count"
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <p className="text-[10px] text-muted-foreground">
                1 for single, or bulk (e.g. 20)
              </p>
            </div>

            {/* Effort */}
            <div className="space-y-2">
              <Label>Effort</Label>
              <Select value={effort} onValueChange={setEffort}>
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
          </div>

          {/* NSFW toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div>
              <Label className="text-sm">NSFW Content</Label>
              <p className="text-[11px] text-muted-foreground">NSFW = Fansly only</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isNsfw}
              onClick={() => setIsNsfw((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                isNsfw ? "bg-blue-500" : "bg-muted-foreground/30"
              }`}
            >
              <span
                className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  isNsfw ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* Preview */}
          {selectedTypeId && count > 0 && (
            <div className="rounded-lg bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Will create{" "}
                <span className="font-medium text-foreground">
                  {count}x {types.find((t) => t.id === selectedTypeId)?.name}
                </span>{" "}
                entries with status{" "}
                <span className="font-medium text-blue-400">edited</span>
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !selectedTypeId}>
            {submitting
              ? "Creating..."
              : count > 1
                ? `Add ${count} entries`
                : "Add entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
