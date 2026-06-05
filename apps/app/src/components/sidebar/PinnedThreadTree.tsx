import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEventHandler,
} from "react";
import { flushSync } from "react-dom";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
  type NeighborReorderRequest,
} from "@/lib/neighbor-reorder";
import { ThreadTreeNodeRow } from "./ProjectRow";
import type { ThreadRowDragBindings } from "./ThreadRow";
import { SIDEBAR_SORTABLE_TRANSITION } from "./sortableMotion";
import type { ProjectThreadNode } from "./projectThreadGroups";
import { useDragClickSuppression } from "./useDragClickSuppression";

export interface PinnedThreadRootReorderCallbacks {
  onSettled: () => void;
}

export interface PinnedThreadTreeProps {
  rootNodes: readonly ProjectThreadNode[];
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  isPinnedReorderPending?: boolean;
  onReorderPinnedRoot?: (
    request: NeighborReorderRequest,
    callbacks: PinnedThreadRootReorderCallbacks,
  ) => void;
}

interface PinnedRootOrderEntry {
  id: string;
}

interface SortablePinnedRootItemProps {
  collapsedEnvironmentIds: Set<string>;
  collapsedThreadIds: Set<string>;
  disabled: boolean;
  node: ProjectThreadNode;
  onProjectSelect?: () => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  selectedThreadId?: string;
}

interface PinnedRootItemProps
  extends Omit<SortablePinnedRootItemProps, "disabled"> {
  consumeClickSuppression?: () => boolean;
}

type PinnedRootDragBindings = ThreadRowDragBindings;
type PinnedThreadTreeClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

function getPinnedRootNodeId(node: ProjectThreadNode): string {
  return node.thread.id;
}

function hasSamePinnedRootOrder(
  order: readonly PinnedRootOrderEntry[],
  rootNodes: readonly ProjectThreadNode[],
): boolean {
  if (order.length !== rootNodes.length) {
    return false;
  }
  return order.every((item, index) => {
    const node = rootNodes[index];
    return node !== undefined && item.id === getPinnedRootNodeId(node);
  });
}

const PinnedRootItem = memo(function PinnedRootItem({
  collapsedEnvironmentIds,
  collapsedThreadIds,
  consumeClickSuppression,
  node,
  onProjectSelect,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  selectedThreadId,
}: PinnedRootItemProps) {
  return (
    <ThreadTreeNodeRow
      projectId={node.thread.projectId}
      node={node}
      depthOffset={0}
      isEnvGrouped={false}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      variant="section"
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      consumeClickSuppression={consumeClickSuppression}
    />
  );
});

const SortablePinnedRootItem = memo(function SortablePinnedRootItem({
  collapsedEnvironmentIds,
  collapsedThreadIds,
  disabled,
  node,
  onProjectSelect,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  selectedThreadId,
}: SortablePinnedRootItemProps) {
  const nodeId = getPinnedRootNodeId(node);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: nodeId,
    disabled,
    transition: SIDEBAR_SORTABLE_TRANSITION,
  });
  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );
  const dragBindings = useMemo<PinnedRootDragBindings>(
    () => ({
      attributes,
      disabled,
      listeners,
      setActivatorNodeRef,
    }),
    [attributes, disabled, listeners, setActivatorNodeRef],
  );

  return (
    <ThreadTreeNodeRow
      projectId={node.thread.projectId}
      node={node}
      depthOffset={0}
      isEnvGrouped={false}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      variant="section"
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      dragBindings={dragBindings}
      sortableRef={setNodeRef}
      sortableStyle={style}
      isDragging={isDragging}
    />
  );
});

export const PinnedThreadTree = memo(function PinnedThreadTree({
  rootNodes,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  isPinnedReorderPending = false,
  onReorderPinnedRoot,
}: PinnedThreadTreeProps) {
  const [optimisticPinnedRootOrder, setOptimisticPinnedRootOrder] =
    useState<PinnedRootOrderEntry[] | null>(null);
  const renderedRootNodes = useMemo(() => {
    if (!optimisticPinnedRootOrder) {
      return rootNodes;
    }
    const nodesById = new Map(
      rootNodes.map((node) => [getPinnedRootNodeId(node), node]),
    );
    const orderedNodes: ProjectThreadNode[] = [];
    for (const item of optimisticPinnedRootOrder) {
      const rootNode = nodesById.get(item.id);
      if (!rootNode) {
        return rootNodes;
      }
      orderedNodes.push(rootNode);
    }
    return orderedNodes;
  }, [optimisticPinnedRootOrder, rootNodes]);
  const renderedRootNodeIds = useMemo(
    () => renderedRootNodes.map(getPinnedRootNodeId),
    [renderedRootNodes],
  );
  const reorderDisabled =
    isPinnedReorderPending || !onReorderPinnedRoot || renderedRootNodes.length < 2;
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 4 },
    }),
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
      if (isPinnedReorderPending) {
        return;
      }
      const { active, over } = event;
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string"
      ) {
        return;
      }
      const request = buildNeighborReorderRequest({
        activeId: active.id,
        overId: over.id,
        items: renderedRootNodes.map((node) => ({
          id: getPinnedRootNodeId(node),
        })),
      });
      if (!request) {
        return;
      }
      const nextOrder = applyNeighborReorder({
        items: renderedRootNodes.map((node) => ({
          id: getPinnedRootNodeId(node),
        })),
        request,
      });
      flushSync(() => {
        setOptimisticPinnedRootOrder(nextOrder);
      });
      onReorderPinnedRoot?.(request, {
        onSettled: () => {
          setOptimisticPinnedRootOrder(null);
        },
      });
    },
    [
      clearDragClickSuppressionSoon,
      isPinnedReorderPending,
      onReorderPinnedRoot,
      renderedRootNodes,
    ],
  );
  useEffect(() => {
    if (!optimisticPinnedRootOrder) {
      return;
    }
    if (hasSamePinnedRootOrder(optimisticPinnedRootOrder, rootNodes)) {
      setOptimisticPinnedRootOrder(null);
    }
  }, [optimisticPinnedRootOrder, rootNodes]);
  const handleClickCapture = useCallback<PinnedThreadTreeClickCaptureHandler>(
    (event) => {
      if (!consumeDragClickSuppression()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeDragClickSuppression],
  );

  if (renderedRootNodes.length === 0) {
    return null;
  }

  return (
    <div
      data-sidebar-sticky-section=""
      className="relative space-y-0.5 group-data-[collapsible=icon]:hidden"
      onClickCapture={handleClickCapture}
    >
      {renderedRootNodes.length > 1 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={renderedRootNodeIds}
            strategy={verticalListSortingStrategy}
          >
            {renderedRootNodes.map((node) => (
              <SortablePinnedRootItem
                key={getPinnedRootNodeId(node)}
                node={node}
                disabled={reorderDisabled}
                selectedThreadId={selectedThreadId}
                collapsedThreadIds={collapsedThreadIds}
                collapsedEnvironmentIds={collapsedEnvironmentIds}
                onProjectSelect={onProjectSelect}
                onToggleThreadCollapsed={onToggleThreadCollapsed}
                onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        renderedRootNodes.map((node) => (
          <PinnedRootItem
            key={getPinnedRootNodeId(node)}
            node={node}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            onProjectSelect={onProjectSelect}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
            consumeClickSuppression={consumeDragClickSuppression}
          />
        ))
      )}
    </div>
  );
});
