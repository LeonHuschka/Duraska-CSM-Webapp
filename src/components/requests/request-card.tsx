"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MoreHorizontal,
  ArrowRight,
  Pencil,
  Trash2,
  Calendar,
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
}

export function RequestCard({ request }: RequestCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const nextStatus = getNextStatus(request.status);

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
      className="group cursor-pointer rounded-xl border border-border/50 bg-card p-3.5 transition-all duration-200 hover:border-border hover:bg-accent/30"
      onClick={() => router.push(`/requests/${request.id}`)}
    >
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
    </div>
  );
}
