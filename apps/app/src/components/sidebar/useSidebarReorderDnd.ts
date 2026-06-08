import { useCallback, useMemo, type MouseEventHandler } from "react";
import {
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DndContextProps,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  useDragClickSuppression,
  type ConsumeDragClickSuppression,
} from "./useDragClickSuppression";

export interface UseSidebarReorderDndArgs {
  /**
   * Performs the reorder once a drag settles. The hook clears the drag-click
   * suppression timer before invoking it, so callers only own the reorder.
   */
  onDragEnd: (event: DragEndEvent) => void;
  /**
   * Defaults to `closestCenter`. Sections override it with a pointer-first
   * strategy because their rows have wildly uneven heights.
   */
  collisionDetection?: CollisionDetection;
}

export type SidebarReorderDndContextProps = Pick<
  DndContextProps,
  | "sensors"
  | "collisionDetection"
  | "onDragStart"
  | "onDragCancel"
  | "onDragEnd"
>;

export interface UseSidebarReorderDndResult {
  /** Spread onto the surface's `DndContext`. */
  dndContextProps: SidebarReorderDndContextProps;
  /**
   * Swallows the click that ends a drag. Wire to the list container's
   * `onClickCapture` and/or hand to rows as their suppression source so the
   * drag-release click never selects a row.
   */
  consumeClickSuppression: ConsumeDragClickSuppression;
  onClickCapture: MouseEventHandler<HTMLElement>;
}

/**
 * Container-side reorder plumbing shared by every sortable sidebar surface
 * (sections, projects, pinned roots, manager roots): the activation-tuned
 * sensors, the drag-click suppression glue, and the `DndContext` handler shell.
 * Pair with {@link useSidebarSortable} on the items inside the context.
 */
export function useSidebarReorderDnd({
  onDragEnd,
  collisionDetection = closestCenter,
}: UseSidebarReorderDndArgs): UseSidebarReorderDndResult {
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragStart = useCallback(
    (_event: DragStartEvent) => {
      beginDragClickSuppression();
    },
    [beginDragClickSuppression],
  );
  const handleDragCancel = useCallback(() => {
    clearDragClickSuppressionSoon();
  }, [clearDragClickSuppressionSoon]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearDragClickSuppressionSoon();
      onDragEnd(event);
    },
    [clearDragClickSuppressionSoon, onDragEnd],
  );
  const onClickCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (!consumeDragClickSuppression()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeDragClickSuppression],
  );
  const dndContextProps = useMemo<SidebarReorderDndContextProps>(
    () => ({
      sensors,
      collisionDetection,
      onDragStart: handleDragStart,
      onDragCancel: handleDragCancel,
      onDragEnd: handleDragEnd,
    }),
    [
      collisionDetection,
      handleDragCancel,
      handleDragEnd,
      handleDragStart,
      sensors,
    ],
  );

  return {
    dndContextProps,
    consumeClickSuppression: consumeDragClickSuppression,
    onClickCapture,
  };
}
