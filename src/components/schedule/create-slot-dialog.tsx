"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { ContentRequest } from "@/lib/types/database";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createSlot } from "@/app/(app)/schedule/actions";

interface CreateSlotDialogProps {
  requests: Pick<ContentRequest, "id" | "title" | "status">[];
}

interface FormValues {
  platform: string;
  scheduled_for: string;
  caption: string;
  request_id: string;
}

export function CreateSlotDialog({ requests }: CreateSlotDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      platform: "instagram",
      scheduled_for: "",
      caption: "",
      request_id: "",
    },
  });

  const platform = watch("platform");
  const requestId = watch("request_id");

  function onSubmit(data: FormValues) {
    if (!data.scheduled_for) {
      toast.error("Please select a date and time");
      return;
    }

    startTransition(async () => {
      const result = await createSlot({
        platform: data.platform,
        scheduled_for: new Date(data.scheduled_for).toISOString(),
        caption: data.caption || undefined,
        request_id: data.request_id && data.request_id !== "none"
          ? data.request_id
          : undefined,
      });

      if (result.error) {
        toast.error("Failed to create slot", { description: result.error });
      } else {
        toast.success("Slot created");
        reset();
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          New Slot
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Schedule Slot</DialogTitle>
          <DialogDescription>
            Add a new post to your content schedule.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Select
              value={platform}
              onValueChange={(v) => setValue("platform", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="fansly">Fansly</SelectItem>
                <SelectItem value="tiktok">TikTok</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scheduled_for">Date & Time</Label>
            <Input
              id="scheduled_for"
              type="datetime-local"
              {...register("scheduled_for", { required: "Date and time is required" })}
            />
            {errors.scheduled_for && (
              <p className="text-xs text-red-400">{errors.scheduled_for.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="caption">Caption</Label>
            <Textarea
              id="caption"
              placeholder="Write a caption for this post..."
              rows={3}
              {...register("caption")}
            />
          </div>

          <div className="space-y-2">
            <Label>Linked Request (optional)</Label>
            <Select
              value={requestId}
              onValueChange={(v) => setValue("request_id", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a request" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {requests.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setOpen(false); reset(); }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create Slot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
