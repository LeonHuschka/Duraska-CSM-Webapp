"use client";

import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { toast } from "sonner";
import type { ContentRequest, ContentType } from "@/lib/types/database";
import { RequestCard } from "@/components/requests/request-card";
import { CreateRequestDialog } from "@/components/requests/create-request-dialog";
import { Badge } from "@/components/ui/badge";
import { updateRequestPosition } from "@/app/(app)/requests/actions";

const COLUMNS = [
  { id: "requested", label: "Requested", color: "bg-purple-400" },
  { id: "shooted", label: "Shooted", color: "bg-amber-400" },
  { id: "edited", label: "Edited", color: "bg-blue-400" },
  { id: "scheduled", label: "Scheduled", color: "bg-emerald-400" },
  { id: "posted", label: "Posted", color: "bg-green-400" },
] as const;

interface KanbanBoardProps {
  requests: ContentRequest[];
  contentTypes: ContentType[];
}

function SortableCard({ request }: { request: ContentRequest }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: request.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <RequestCard request={request} />
    </div>
  );
}

function DroppableColumn({
  column,
  items,
  isOver,
}: {
  column: (typeof COLUMNS)[number];
  items: ContentRequest[];
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);

  return (
    <div className="flex w-72 min-w-[288px] shrink-0 flex-col">
      <div className="mb-3 flex items-center gap-2.5 px-1">
        <div className={`h-2.5 w-2.5 rounded-full ${column.color}`} />
        <h3 className="text-sm font-medium">{column.label}</h3>
        <Badge
          variant="secondary"
          className="ml-auto h-5 min-w-[20px] justify-center px-1.5 text-[10px]"
        >
          {items.length}
        </Badge>
      </div>

      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex flex-1 flex-col gap-2.5 rounded-xl border p-2.5 min-h-[200px] transition-colors duration-200 ${
            isOver
              ? "border-primary/50 bg-primary/5"
              : "border-border/30 bg-muted/30"
          }`}
        >
          {items.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-xs text-muted-foreground/60">No requests</p>
            </div>
          ) : (
            items.map((request) => (
              <SortableCard key={request.id} request={request} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function KanbanBoard({ requests, contentTypes }: KanbanBoardProps) {
  const [items, setItems] = useState<ContentRequest[]>(requests);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const grouped = useMemo(
    () =>
      COLUMNS.map((col) => ({
        ...col,
        items: items
          .filter((r) => r.status === col.id)
          .sort((a, b) => a.position - b.position),
      })),
    [items]
  );

  const activeRequest = useMemo(
    () => items.find((r) => r.id === activeId) ?? null,
    [items, activeId]
  );

  const findColumn = useCallback(
    (id: string): string | null => {
      if (COLUMNS.some((c) => c.id === id)) return id;
      const item = items.find((r) => r.id === id);
      return item?.status ?? null;
    },
    [items]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) {
        setOverColumnId(null);
        return;
      }

      const activeCol = findColumn(active.id as string);
      const overCol = findColumn(over.id as string);

      if (!activeCol || !overCol) {
        setOverColumnId(null);
        return;
      }

      setOverColumnId(overCol);

      if (activeCol !== overCol) {
        setItems((prev) => {
          const updated = prev.map((item) =>
            item.id === active.id ? { ...item, status: overCol } : item
          );
          return updated;
        });
      }
    },
    [findColumn]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverColumnId(null);

      if (!over) return;

      const activeItem = items.find((r) => r.id === active.id);
      if (!activeItem) return;

      const targetCol = findColumn(over.id as string);
      if (!targetCol) return;

      const columnItems = items
        .filter((r) => r.status === targetCol)
        .sort((a, b) => a.position - b.position);

      const oldIndex = columnItems.findIndex((r) => r.id === active.id);
      const overIndex = columnItems.findIndex((r) => r.id === over.id);

      let reordered = columnItems;
      if (oldIndex !== -1 && overIndex !== -1 && oldIndex !== overIndex) {
        reordered = arrayMove(columnItems, oldIndex, overIndex);
      }

      const originalRequest = requests.find((r) => r.id === active.id);
      const statusChanged = originalRequest?.status !== targetCol;
      const positionChanged =
        reordered.findIndex((r) => r.id === active.id) !== oldIndex ||
        statusChanged;

      if (!statusChanged && !positionChanged) return;

      const newPosition = Date.now();
      setItems((prev) => {
        const others = prev.filter(
          (r) => r.status !== targetCol || r.id === active.id
        );
        const final = reordered.map((r) => ({
          ...r,
          position: r.id === active.id ? newPosition : r.position,
        }));
        const rest = others.filter((r) => r.id !== active.id);
        const movedItem = prev.find((r) => r.id === active.id);
        if (!movedItem) return prev;
        return [
          ...rest,
          ...final.map((r) =>
            r.id === active.id
              ? { ...movedItem, status: targetCol, position: newPosition }
              : r
          ),
        ];
      });

      (async () => {
        try {
          if (statusChanged) {
            await updateRequestPosition(
              active.id as string,
              newPosition,
              targetCol
            );
          } else {
            await updateRequestPosition(active.id as string, newPosition);
          }
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Failed to move request"
          );
          setItems(requests);
        }
      })();
    },
    [items, requests, findColumn]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverColumnId(null);
    setItems(requests);
  }, [requests]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Requests Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track content through your production pipeline
          </p>
        </div>
        <CreateRequestDialog contentTypes={contentTypes} />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 md:-mx-6 md:px-6">
          {grouped.map((column) => (
            <DroppableColumn
              key={column.id}
              column={column}
              items={column.items}
              isOver={overColumnId === column.id}
            />
          ))}
        </div>

        <DragOverlay>
          {activeRequest ? (
            <div className="rotate-2 scale-105">
              <RequestCard request={activeRequest} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
