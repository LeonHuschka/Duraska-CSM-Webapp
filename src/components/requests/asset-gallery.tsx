"use client";

import { useState } from "react";
import { Trash2, Film, Image as ImageIcon, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssetWithUrl } from "@/app/(app)/requests/[id]/page";

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isVideo(mimeType: string | null): boolean {
  return mimeType?.startsWith("video/") ?? false;
}

interface AssetGalleryProps {
  assets: AssetWithUrl[];
  onDelete: (assetId: string) => void;
}

export function AssetGallery({ assets, onDelete }: AssetGalleryProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (assetId: string) => {
    setDeletingId(assetId);
    try {
      onDelete(assetId);
    } finally {
      setDeletingId(null);
    }
  };

  if (assets.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border/30 bg-muted/20 p-8">
        <p className="text-sm text-muted-foreground/60">No files uploaded yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className="group relative overflow-hidden rounded-xl border border-border/50 bg-card transition-all duration-200 hover:border-border"
        >
          {/* Preview */}
          <div className={`relative bg-muted/30 ${isVideo(asset.mime_type) ? "aspect-[9/16]" : "aspect-video"}`}>
            {isVideo(asset.mime_type) ? (
              <video
                controls
                playsInline
                preload="metadata"
                src={`${asset.signedUrl}#t=0.001`}
                className="h-full w-full rounded-t-xl object-contain bg-black"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={asset.signedUrl}
                alt={asset.file_name}
                className="h-full w-full rounded-t-xl object-cover"
              />
            )}

            {/* Type indicator */}
            <div className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5">
              {isVideo(asset.mime_type) ? (
                <Film className="h-3.5 w-3.5 text-white" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5 text-white" />
              )}
            </div>

            {/* Action buttons */}
            <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <a
                href={asset.signedUrl}
                download={asset.file_name}
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-7 w-7"
                  asChild
                >
                  <span>
                    <Download className="h-3.5 w-3.5" />
                  </span>
                </Button>
              </a>
              <Button
                variant="destructive"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleDelete(asset.id)}
                disabled={deletingId === asset.id}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Info */}
          <div className="p-2.5">
            <p className="truncate text-xs font-medium" title={asset.file_name}>
              {asset.file_name}
            </p>
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{formatFileSize(asset.size_bytes)}</span>
              <span>{formatDate(asset.uploaded_at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
