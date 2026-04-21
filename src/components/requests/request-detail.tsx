"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Pencil,
  Calendar,
  ExternalLink,
  Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { AssetUpload } from "@/components/requests/asset-upload";
import { AssetGallery } from "@/components/requests/asset-gallery";
import {
  deleteAsset,
  updateRequestDetail,
} from "@/app/(app)/requests/[id]/actions";
import type { ContentRequest } from "@/lib/types/database";
import type { AssetWithUrl } from "@/app/(app)/requests/[id]/page";

const STATUS_STYLES: Record<string, string> = {
  requested: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  shooted: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  edited: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  scheduled: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  posted: "bg-green-500/15 text-green-400 border-green-500/30",
  archived: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const EFFORT_STYLES: Record<string, string> = {
  easy: "bg-green-500/15 text-green-400 border-green-500/30",
  medium: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  heavy: "bg-red-500/15 text-red-400 border-red-500/30",
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface RequestDetailProps {
  request: ContentRequest;
  assets: AssetWithUrl[];
  personaId: string;
}

export function RequestDetail({
  request,
  assets,
  personaId,
}: RequestDetailProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [description, setDescription] = useState(request.description ?? "");
  const [effort, setEffort] = useState(request.priority);
  const [status, setStatus] = useState(request.status);
  const [dueDate, setDueDate] = useState(request.due_date ?? "");
  const [inspoLink, setInspoLink] = useState(request.inspo_link ?? "");
  const [isNsfw, setIsNsfw] = useState(request.is_nsfw);

  const rawAssets = assets.filter((a) => a.stage === "raw");
  const editedAssets = assets.filter((a) => a.stage === "edited");

  const handleEditSave = () => {
    startTransition(async () => {
      try {
        await updateRequestDetail(request.id, {
          description,
          priority: effort,
          status,
          due_date: dueDate || undefined,
          inspo_link: inspoLink || undefined,
          is_nsfw: isNsfw,
        });
        toast.success("Request updated");
        setEditOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update request"
        );
      }
    });
  };

  const handleDeleteAsset = (assetId: string) => {
    startTransition(async () => {
      try {
        await deleteAsset(assetId, request.id);
        toast.success("File deleted");
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete file"
        );
      }
    });
  };

  const handleUploadComplete = () => {
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/requests"
          className="flex items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Requests
        </Link>
        <span>/</span>
        <span className="text-foreground">{request.title}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {request.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`text-xs capitalize ${STATUS_STYLES[request.status] ?? STATUS_STYLES.requested}`}
            >
              {request.status}
            </Badge>
            {request.is_nsfw ? (
              <Badge variant="outline" className="text-xs bg-blue-500/15 text-blue-400 border-blue-500/30">
                NSFW
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs bg-green-500/15 text-green-400 border-green-500/30">
                SFW
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-xs capitalize ${EFFORT_STYLES[request.priority] ?? EFFORT_STYLES.medium}`}
            >
              {request.priority} effort
            </Badge>
            {request.due_date && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Due {formatDate(request.due_date)}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Created {formatDateTime(request.created_at)}
            </span>
          </div>

          {/* Description - prominent display */}
          {request.description && (
            <div className="mt-3 rounded-lg border border-border/50 bg-muted/20 p-3">
              <p className="text-sm whitespace-pre-wrap">{request.description}</p>
            </div>
          )}

          {/* Inspo Link - prominent display */}
          {request.inspo_link && (
            <a
              href={request.inspo_link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-primary hover:bg-primary/10 transition-colors"
            >
              <ExternalLink className="h-4 w-4 shrink-0" />
              <span className="truncate">{request.inspo_link}</span>
            </a>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
      </div>

      {/* Upload sections */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Raw Content</h2>
            <p className="text-sm text-muted-foreground">
              Upload photos and videos from the shoot
            </p>
          </div>
          <AssetUpload
            requestId={request.id}
            personaId={personaId}
            stage="raw"
            onUploadComplete={handleUploadComplete}
          />
          <AssetGallery assets={rawAssets} onDelete={handleDeleteAsset} />
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Edited Content</h2>
            <p className="text-sm text-muted-foreground">
              Upload the final edited video
            </p>
          </div>
          <AssetUpload
            requestId={request.id}
            personaId={personaId}
            stage="edited"
            onUploadComplete={handleUploadComplete}
          />
          <AssetGallery assets={editedAssets} onDelete={handleDeleteAsset} />
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Request</DialogTitle>
            <DialogDescription>
              Update the details for this content request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-detail-description">Description</Label>
              <Textarea
                id="edit-detail-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-inspo-link">Inspo Link</Label>
              <Input
                id="edit-inspo-link"
                placeholder="https://..."
                value={inspoLink}
                onChange={(e) => setInspoLink(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
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

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="requested">Requested</SelectItem>
                    <SelectItem value="shooted">Shooted</SelectItem>
                    <SelectItem value="edited">Edited</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="posted">Posted</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-detail-due-date">Due Date</Label>
              <Input
                id="edit-detail-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
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

            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Created</Label>
              <p className="text-sm">{formatDateTime(request.created_at)}</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
