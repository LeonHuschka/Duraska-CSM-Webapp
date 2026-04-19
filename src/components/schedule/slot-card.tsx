"use client";

import { useState, useTransition } from "react";
import type { ScheduleSlot, ContentRequest } from "@/lib/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import {
  MoreHorizontal,
  CheckCircle2,
  Pencil,
  Trash2,
  Clock,
  ExternalLink,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { updateSlot, deleteSlot, markSlotPosted } from "@/app/(app)/schedule/actions";

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-500",
  fansly: "bg-blue-500",
  tiktok: "bg-slate-700",
  other: "bg-gray-500",
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  fansly: "Fansly",
  tiktok: "TikTok",
  other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  planned: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  ready: "bg-green-500/15 text-green-400 border-green-500/30",
  posted: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

interface SlotCardProps {
  slot: ScheduleSlot;
  requests: Pick<ContentRequest, "id" | "title" | "status">[];
  compact?: boolean;
}

export function SlotCard({ slot, requests, compact = false }: SlotCardProps) {
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [postUrlOpen, setPostUrlOpen] = useState(false);
  const [postUrl, setPostUrl] = useState("");

  // Edit form state
  const [editPlatform, setEditPlatform] = useState(slot.platform);
  const [editScheduledFor, setEditScheduledFor] = useState(
    toDatetimeLocal(slot.scheduled_for)
  );
  const [editCaption, setEditCaption] = useState(slot.caption ?? "");
  const [editRequestId, setEditRequestId] = useState(slot.request_id ?? "");

  const linkedRequest = requests.find((r) => r.id === slot.request_id);
  const scheduledDate = new Date(slot.scheduled_for);
  const timeStr = scheduledDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteSlot(slot.id);
      if (result.error) {
        toast.error("Failed to delete slot", { description: result.error });
      } else {
        toast.success("Slot deleted");
      }
    });
  }

  function handleMarkPosted() {
    if (postUrl.trim()) {
      startTransition(async () => {
        const result = await markSlotPosted(slot.id, postUrl.trim());
        if (result.error) {
          toast.error("Failed to mark as posted", { description: result.error });
        } else {
          toast.success("Marked as posted");
          setPostUrlOpen(false);
          setPostUrl("");
        }
      });
    } else {
      startTransition(async () => {
        const result = await markSlotPosted(slot.id);
        if (result.error) {
          toast.error("Failed to mark as posted", { description: result.error });
        } else {
          toast.success("Marked as posted");
          setPostUrlOpen(false);
        }
      });
    }
  }

  function handleEdit() {
    startTransition(async () => {
      const result = await updateSlot(slot.id, {
        platform: editPlatform,
        scheduled_for: new Date(editScheduledFor).toISOString(),
        caption: editCaption || undefined,
        request_id: editRequestId || null,
      });
      if (result.error) {
        toast.error("Failed to update slot", { description: result.error });
      } else {
        toast.success("Slot updated");
        setEditOpen(false);
      }
    });
  }

  if (compact) {
    return (
      <>
        <div className="group flex items-center gap-2 rounded-lg border border-border/50 bg-card p-2 text-xs transition-colors hover:border-border">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${PLATFORM_COLORS[slot.platform] ?? PLATFORM_COLORS.other}`}
          />
          <span className="truncate font-medium">
            {timeStr}
          </span>
          {slot.caption && (
            <span className="truncate text-muted-foreground">
              {slot.caption}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
              >
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {slot.status !== "posted" && (
                <DropdownMenuItem onClick={() => setPostUrlOpen(true)}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Mark as Posted
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-400 focus:text-red-400"
                onClick={handleDelete}
                disabled={isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {renderEditDialog()}
        {renderPostUrlDialog()}
      </>
    );
  }

  return (
    <>
      <div className="group flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border">
        {/* Platform dot */}
        <span
          className={`h-3 w-3 shrink-0 rounded-full ${PLATFORM_COLORS[slot.platform] ?? PLATFORM_COLORS.other}`}
          title={PLATFORM_LABELS[slot.platform] ?? slot.platform}
        />

        {/* Time */}
        <div className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {timeStr}
        </div>

        {/* Caption + request */}
        <div className="min-w-0 flex-1">
          {slot.caption ? (
            <p className="truncate text-sm font-medium">{slot.caption}</p>
          ) : (
            <p className="truncate text-sm italic text-muted-foreground">
              No caption
            </p>
          )}
          {linkedRequest && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Link2 className="h-3 w-3" />
              {linkedRequest.title}
            </p>
          )}
        </div>

        {/* Platform label */}
        <span className="hidden text-xs capitalize text-muted-foreground sm:block">
          {PLATFORM_LABELS[slot.platform] ?? slot.platform}
        </span>

        {/* Post URL */}
        {slot.post_url && (
          <a
            href={slot.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}

        {/* Status badge */}
        <Badge
          variant="outline"
          className={`shrink-0 capitalize ${STATUS_STYLES[slot.status] ?? ""}`}
        >
          {slot.status}
        </Badge>

        {/* Actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {slot.status !== "posted" && (
              <DropdownMenuItem onClick={() => setPostUrlOpen(true)}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Mark as Posted
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-400 focus:text-red-400"
              onClick={handleDelete}
              disabled={isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {renderEditDialog()}
      {renderPostUrlDialog()}
    </>
  );

  function renderEditDialog() {
    return (
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Slot</DialogTitle>
            <DialogDescription>
              Update the details for this schedule slot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select value={editPlatform} onValueChange={setEditPlatform}>
                <SelectTrigger>
                  <SelectValue />
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
              <Label>Scheduled For</Label>
              <Input
                type="datetime-local"
                value={editScheduledFor}
                onChange={(e) => setEditScheduledFor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Caption</Label>
              <Textarea
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                placeholder="Write a caption..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Linked Request</Label>
              <Select
                value={editRequestId}
                onValueChange={setEditRequestId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
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
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={slot.status}
                onValueChange={(val) => {
                  startTransition(async () => {
                    const result = await updateSlot(slot.id, { status: val });
                    if (result.error) {
                      toast.error("Failed to update status");
                    }
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planned</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="posted">Posted</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  function renderPostUrlDialog() {
    return (
      <Dialog open={postUrlOpen} onOpenChange={setPostUrlOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Posted</DialogTitle>
            <DialogDescription>
              Optionally add a link to the published post.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Post URL (optional)</Label>
              <Input
                type="url"
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostUrlOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleMarkPosted} disabled={isPending}>
              {isPending ? "Saving..." : "Mark as Posted"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
}

function toDatetimeLocal(isoString: string): string {
  const date = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
