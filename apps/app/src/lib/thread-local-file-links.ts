import type { ThreadTimelineLocalFileLink } from "@/components/thread/timeline";
import { matchPath } from "react-router-dom";
import {
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "./absolute-file-path";
import { APP_ROUTE_PATTERNS } from "./app-route-paths";

const THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION =
  "Thread file links are only available when the thread has an environment.";
const THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION =
  "Thread file links must use absolute file paths.";

export interface ResolveThreadLocalFileLinkArgs {
  hostFileLinksAvailable: boolean;
  link: ThreadTimelineLocalFileLink;
  threadStorageRootPath: string | null;
  workspaceRootPath: string | null;
}

export interface ThreadWorkspaceFileLinkOpenRequest {
  lineNumber: number | null;
  path: string;
  relativePath: string;
  workspaceRootPath: string;
}

export interface ThreadHostFileLinkOpenRequest {
  lineNumber: number | null;
  path: string;
}

export interface ThreadStorageFileLinkOpenRequest {
  lineNumber: number | null;
  path: string;
  relativePath: string;
  threadStorageRootPath: string;
}

interface ThreadLocalFileLinkAppRouteResolution {
  kind: "app-route";
}

interface ThreadLocalFileLinkErrorResolution {
  description: string;
  kind: "error";
}

interface ThreadWorkspaceFileLinkOpenResolution {
  kind: "open-workspace-path";
  request: ThreadWorkspaceFileLinkOpenRequest;
}

interface ThreadHostFileLinkOpenResolution {
  kind: "open-host-path";
  request: ThreadHostFileLinkOpenRequest;
}

interface ThreadStorageFileLinkOpenResolution {
  kind: "open-thread-storage-path";
  request: ThreadStorageFileLinkOpenRequest;
}

interface NormalizeLocalFilePathWithinRootArgs {
  linkPath: string;
  rootPath: string;
}

interface NormalizedLocalFilePathWithinRoot {
  path: string;
  relativePath: string;
  rootPath: string;
}

export type ThreadLocalFileLinkResolution =
  | ThreadLocalFileLinkAppRouteResolution
  | ThreadLocalFileLinkErrorResolution
  | ThreadWorkspaceFileLinkOpenResolution
  | ThreadHostFileLinkOpenResolution
  | ThreadStorageFileLinkOpenResolution;

function isAppRoutePath(path: string): boolean {
  return APP_ROUTE_PATTERNS.some(
    (pattern) => matchPath(pattern, path) !== null,
  );
}

function normalizeLocalFilePathWithinRoot(
  args: NormalizeLocalFilePathWithinRootArgs,
): NormalizedLocalFilePathWithinRoot | null {
  const normalizedRootPath = normalizeAbsoluteFilePath({ path: args.rootPath });
  if (!normalizedRootPath) {
    return null;
  }

  const normalizedPath = normalizeAbsoluteFilePath({ path: args.linkPath });
  if (!normalizedPath) {
    return null;
  }

  if (
    !isAbsoluteFilePathWithinRoot({
      candidatePath: normalizedPath,
      rootPath: normalizedRootPath,
    }) ||
    normalizedPath === normalizedRootPath
  ) {
    return null;
  }

  const relativePath =
    normalizedRootPath === "/"
      ? normalizedPath.slice(1)
      : normalizedPath.slice(normalizedRootPath.length + 1);

  return {
    path: normalizedPath,
    relativePath,
    rootPath: normalizedRootPath,
  };
}

export function resolveThreadLocalFileLink(
  args: ResolveThreadLocalFileLinkArgs,
): ThreadLocalFileLinkResolution {
  if (isAppRoutePath(args.link.path)) {
    return {
      kind: "app-route",
    };
  }

  const normalizedPath = normalizeAbsoluteFilePath({ path: args.link.path });
  if (!normalizedPath) {
    return {
      description: THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION,
      kind: "error",
    };
  }

  const openRequest =
    args.workspaceRootPath === null
      ? null
      : normalizeLocalFilePathWithinRoot({
          linkPath: normalizedPath,
          rootPath: args.workspaceRootPath,
        });

  if (openRequest) {
    return {
      kind: "open-workspace-path",
      request: {
        lineNumber: args.link.lineNumber,
        path: openRequest.path,
        relativePath: openRequest.relativePath,
        workspaceRootPath: openRequest.rootPath,
      },
    };
  }

  const storageOpenRequest =
    args.threadStorageRootPath === null
      ? null
      : normalizeLocalFilePathWithinRoot({
          linkPath: normalizedPath,
          rootPath: args.threadStorageRootPath,
        });

  if (storageOpenRequest) {
    return {
      kind: "open-thread-storage-path",
      request: {
        lineNumber: args.link.lineNumber,
        path: storageOpenRequest.path,
        relativePath: storageOpenRequest.relativePath,
        threadStorageRootPath: storageOpenRequest.rootPath,
      },
    };
  }

  if (!args.hostFileLinksAvailable) {
    return {
      description: THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION,
      kind: "error",
    };
  }

  return {
    kind: "open-host-path",
    request: {
      lineNumber: args.link.lineNumber,
      path: normalizedPath,
    },
  };
}
