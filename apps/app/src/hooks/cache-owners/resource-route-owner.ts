import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ChangedMessage,
  ProjectChangedMessage,
  ThreadChangedMessage,
} from "@bb/domain";
import { collapsedProjectIdsAtom } from "@/components/sidebar/sidebarCollapsedAtoms";
import { getRootComposeRoutePath } from "@/lib/app-route-paths";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { useAppRoute } from "../useAppRoute";
import { getCachedThreadProjectId } from "./thread-detail-cache-owner";

export type DeletedResourceRouteChangeHandler = (
  message: ChangedMessage,
) => void;

function isDeletedProjectMessage(
  message: ChangedMessage,
): message is ProjectChangedMessage & { id: string } {
  return (
    message.entity === "project" &&
    message.id !== undefined &&
    message.changes.includes("project-deleted")
  );
}

function isDeletedThreadMessage(
  message: ChangedMessage,
): message is ThreadChangedMessage & { id: string } {
  return (
    message.entity === "thread" &&
    message.id !== undefined &&
    message.changes.includes("thread-deleted")
  );
}

export function useDeletedResourceRouteOwner(): DeletedResourceRouteChangeHandler {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setCollapsedProjectIdList = useSetAtom(collapsedProjectIdsAtom);
  const [, setRootComposeProjectId] = useRootComposeProjectId();
  const { projectId: routeProjectId, threadId: routeThreadId } = useAppRoute();

  return useCallback(
    (message: ChangedMessage) => {
      if (isDeletedProjectMessage(message)) {
        const deletedProjectId = message.id;
        setCollapsedProjectIdList((current) =>
          current.filter((projectId) => projectId !== deletedProjectId),
        );
        if (routeProjectId === deletedProjectId) {
          navigate(getRootComposeRoutePath(), { replace: true });
        }
        return;
      }

      if (!isDeletedThreadMessage(message)) {
        return;
      }
      const deletedThreadId = message.id;
      if (routeThreadId !== deletedThreadId) {
        return;
      }

      const projectId = getCachedThreadProjectId({
        queryClient,
        threadId: deletedThreadId,
      });
      if (projectId) {
        setRootComposeProjectId(projectId);
      }
      navigate(getRootComposeRoutePath());
    },
    [
      navigate,
      queryClient,
      routeProjectId,
      routeThreadId,
      setCollapsedProjectIdList,
      setRootComposeProjectId,
    ],
  );
}
