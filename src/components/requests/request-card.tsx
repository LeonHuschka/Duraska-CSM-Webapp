"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MoreHorizontal,
  ArrowRight,
  Pencil,
  Trash2,
  Calendar,
  Upload,
} from "lucide-react";
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
  updateRequestStatus,
  deleteRequest,
} from "@/app/(app)/requests/actions";
import { createAssetRecord } from "@/app/(app)/requests/[id]/actions";
import { createClient } from "@/lib/supabase/client";
import type { ContentRequest } from "@/lib/types/database";

const STATUS_FLOW = ["requested", "shooted", "edited", "scheduled", "posted"];

const EFFORT_STYLES: Record<string, string> = {
  easy: "bg-green-500/15 text-green-400 border-green-500/30",
  medium: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  heavy: "bg-red-500/15 text-red-400 border-red-500/30",
};

function getNextStatus(current: string): string | null {
  const idx = STATUS_FLOW.indexOf(current);
  if (idx === -1 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface RequestCardProps {
  request: ContentRequest;
  personaId?: string;
}

export function RequestCard({ request, personaId }: RequestCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fileDragOver, setFileDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const nextStatus = getNextStatus(request.status);

  const handleFileDrop = useCallback(
    async (files: FileList) => {
      if (!personaId) return;
      const fileArray = Array.from(files).filter(
        (f) => f.type.startsWith("video/") || f.type.startsWith("image/") || f.name.toLowerCase().endsWith(".mov")
      );
      if (fileArray.length === 0) {
        toast.error("Only image/video files supported");
        return;
      }

      setUploading(true);
      const supabase = createClient();
      let completed = 0;

      try {
        for (const file of fileArray) {
          const uuid = crypto.randomUUID();
          const filePath = `personas/${personaId}/requests/${request.id}/edited/${uuid}_${file.name}`;

          const { error: uploadError } = await supabase.storage
            .from("content-assets")
            .upload(filePath, file);

          if (uploadError) {
            toast.error(`Failed: ${file.name}`);
            continue;
          }

          try {
            await createAssetRecord({
              request_id: request.id,
              stage: "edited",
              file_path: filePath,
              file_name: file.name,
              mime_type: file.type,
              size_bytes: file.size,
            });
            completed++;
          } catch {
            await supabase.storage.from("content-assets").remove([filePath]);
            toast.error(`Record failed: ${file.name}`);
          }
        }

        if (completed > 0) {
          toast.success(`${completed} file${completed > 1 ? "s" : ""} uploaded to ${request.title}`);
          router.refresh();
        }
      } catch {
        toast.error("Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [personaId, request.id, request.title, router]
  );

  const handleMoveNext = () => {
    if (!nextStatus) return;
    startTransition(async () => {
      try {
        await updateRequestStatus(request.id, nextStatus);
        toast.success(`Moved to ${nextStatus}`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update status"
        );
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteRequest(request.id);
        toast.success("Request deleted");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete request"
        );
      }
    });
  };

  return (
    <div
      className={`group cursor-pointer rounded-xl border p-3.5 transition-all duration-200 ${
        fileDragOver
          ? "border-primary bg-primary/10 border-dashed"
          : uploading
            ? "border-blue-500/50 bg-blue-500/5"
            : request.is_nsfw
              ? "border-blue-500/40 bg-blue-500/5 hover:border-blue-500/60 hover:bg-blue-500/10"
              : "border-border/50 bg-card hover:border-border hover:bg-accent/30"
      }`}
      onClick={() => !uploading && router.push(`/requests/${request.id}`)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
          setFileDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setFileDragOver(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
          setFileDragOver(false);
          handleFileDrop(e.dataTransfer.files);
        }
      }}
    >
      {fileDragOver ? (
        <div className="flex items-center justify-center gap-2 py-2">
          <Upload className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-primary">Drop to upload</span>
        </div>
      ) : uploading ? (
        <div className="flex items-center justify-center gap-2 py-2">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          <span className="text-xs font-medium text-blue-400">Uploading...</span>
        </div>
      ) : (
      <>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-snug line-clamp-2">
          {request.title}
        </h4>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {nextStatus && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleMoveNext();
                }}
                disabled={isPending}
              >
                <ArrowRight className="h-4 w-4" />
                Move to {nextStatus}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/requests/${request.id}`);
              }}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              disabled={isPending}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        {request.is_nsfw ? (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-500/15 text-blue-400 border-blue-500/30">
            NSFW
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-green-500/15 text-green-400 border-green-500/30">
            SFW
          </Badge>
        )}
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 ${EFFORT_STYLES[request.priority] ?? EFFORT_STYLES.medium}`}
        >
          {request.priority}
        </Badge>
        {request.due_date && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(request.due_date)}
          </span>
        )}
      </div>
      </>
      )}
    </div>
  );
}
