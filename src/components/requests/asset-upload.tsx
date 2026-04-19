"use client";

import { useState, useRef, useCallback } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createAssetRecord } from "@/app/(app)/requests/[id]/actions";

interface AssetUploadProps {
  requestId: string;
  personaId: string;
  stage: "raw" | "edited";
  onUploadComplete: () => void;
}

export function AssetUpload({
  requestId,
  personaId,
  stage,
  onUploadComplete,
}: AssetUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      setUploading(true);
      setProgress(0);

      const supabase = createClient();
      let completed = 0;

      try {
        for (const file of fileArray) {
          const uuid = crypto.randomUUID();
          const filePath = `personas/${personaId}/requests/${requestId}/${stage}/${uuid}_${file.name}`;

          const { error: uploadError } = await supabase.storage
            .from("content-assets")
            .upload(filePath, file);

          if (uploadError) {
            toast.error(`Failed to upload ${file.name}: ${uploadError.message}`);
            continue;
          }

          try {
            await createAssetRecord({
              request_id: requestId,
              stage,
              file_path: filePath,
              file_name: file.name,
              mime_type: file.type,
              size_bytes: file.size,
            });
          } catch (err) {
            toast.error(
              `Failed to save record for ${file.name}: ${err instanceof Error ? err.message : "Unknown error"}`
            );
            // Clean up the uploaded file if record creation fails
            await supabase.storage.from("content-assets").remove([filePath]);
            continue;
          }

          completed++;
          setProgress(Math.round((completed / fileArray.length) * 100));
        }

        if (completed > 0) {
          toast.success(
            `${completed} file${completed > 1 ? "s" : ""} uploaded successfully`
          );
          onUploadComplete();
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Upload failed"
        );
      } finally {
        setUploading(false);
        setProgress(0);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [requestId, personaId, stage, onUploadComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-all duration-200 ${
          dragOver
            ? "border-primary bg-primary/10"
            : "border-border/50 hover:border-primary/50 hover:bg-accent/20"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium text-muted-foreground">
            {uploading
              ? `Uploading... ${progress}%`
              : "Tap to upload or drag files here"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Photos and videos
          </p>
        </div>

        {uploading && (
          <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden rounded-b-xl bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*,.mov,.MOV"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
