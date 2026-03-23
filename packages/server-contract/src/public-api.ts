import type { Hono } from "hono";
import { hc } from "hono/client";
import type { EnvironmentDaemonSessionListResponse } from "@bb/env-daemon-contract";
import type {
  AvailableModel,
  EnvironmentRecord,
  Project,
  Thread,
  ThreadEventRow,
  ThreadExecutionOptions,
  ThreadQueuedMessage,
  ThreadType,
  ThreadWorkStatus,
} from "@bb/domain";
import type { EmptyInput, Endpoint, PathId, PathProjectId, PathThreadAndQueued } from "./common.js";
import type {
  CreateProjectRequest,
  DemotePrimaryCheckoutResponse,
  EnqueueThreadMessageRequest,
  EnvironmentOperationApiError,
  EnvironmentOperationRequest,
  EnvironmentOperationResponse,
  OpenPathRequest,
  OpenThreadPathRequest,
  PrimaryCheckoutStatus,
  ProjectFileSuggestion,
  PromotePrimaryCheckoutResponse,
  PromptMentionSuggestion,
  SendQueuedThreadMessageRequest,
  SendQueuedThreadMessageResponse,
  SpawnThreadRequest,
  SystemEnvironmentInfo,
  SystemHealthReport,
  SystemProviderInfo,
  SystemRestartAcceptedResponse,
  SystemRestartPolicy,
  SystemRestartRequest,
  SystemShutdownAcceptedResponse,
  SystemShutdownBlockedResponse,
  SystemShutdownRequest,
  SystemStatus,
  SystemVoiceTranscriptionResponse,
  TellThreadRequest,
  ThreadGitDiffResponse,
  ThreadTimelineResponse,
  ThreadToolGroupMessagesResponse,
  UpdateProjectRequest,
  UpdateThreadRequest,
  UploadedPromptAttachment,
} from "./api-types.js";
import type { ApiError } from "./errors.js";

// Re-export all schemas and types from api-types
export * from "./api-types.js";

export type PublicApiSchema = {
  "/projects": {
    $get: Endpoint<EmptyInput, Project[]>;
    $post: Endpoint<{ json: CreateProjectRequest }, Project, 201>;
  };
  "/projects/:id": {
    $get: Endpoint<PathProjectId, Project>;
    $patch: Endpoint<PathProjectId & { json: UpdateProjectRequest }, Project>;
    $delete: Endpoint<PathProjectId, { ok: true }>;
  };
  /** Spawns a new manager thread for this project. Managers supervise child
   *  threads and have a dedicated inspectable workspace surfaced through the
   *  manager-workspace endpoints. */
  "/projects/:id/manager": {
    $post: Endpoint<
      PathProjectId & {
        json: {
          title?: string;
          providerId?: string;
          model?: string;
          reasoningLevel?: "low" | "medium" | "high" | "xhigh";
        };
      },
      Thread,
      201
    >;
  };
  "/projects/:id/files": {
    $get: Endpoint<
      PathProjectId & { query: { query?: string; limit?: string } },
      ProjectFileSuggestion[]
    >;
  };
  "/projects/:id/workspace-status": {
    $get: Endpoint<PathProjectId, ThreadWorkStatus>;
  };
  "/projects/:id/attachments": {
    $post: Endpoint<
      PathProjectId & { form: Record<string, string | Blob> },
      UploadedPromptAttachment,
      201
    >;
  };
  "/projects/:id/attachments/content": {
    $get: Endpoint<
      PathProjectId & { query: { path: string } },
      string,
      200,
      "text"
    >;
  };
  "/environments": {
    $get: Endpoint<{ query?: { projectId?: string } }, EnvironmentRecord[]>;
  };
  "/environments/:id": {
    $get:
      | Endpoint<PathId, EnvironmentRecord, 200>
      | Endpoint<PathId, ApiError, 404>;
  };
  /** Performs a git or environment lifecycle operation for the environment.
   *  Supported operations include primary-checkout promotion/demotion,
   *  commit creation, and squash-merge flows. */
  "/environments/:id/operations": {
    $post:
      | Endpoint<
          PathId & { json: EnvironmentOperationRequest },
          EnvironmentOperationResponse,
          200
        >
      | Endpoint<
          PathId & { json: EnvironmentOperationRequest },
          EnvironmentOperationApiError,
          409
        >
      | Endpoint<
          PathId & { json: EnvironmentOperationRequest },
          ApiError,
          404
        >;
  };
  "/environments/:id/env-daemon/sessions": {
    $get: Endpoint<PathId, EnvironmentDaemonSessionListResponse>;
  };
  "/threads": {
    $get: Endpoint<
      {
        query?: {
          projectId?: string;
          type?: ThreadType;
          parentThreadId?: string;
          includeArchived?: "true" | "false";
          includeWorkStatus?: "true" | "false";
        };
      },
      Thread[]
    >;
    $post: Endpoint<{ json: SpawnThreadRequest }, Thread, 201>;
  };
  "/threads/:id": {
    $get: Endpoint<PathId, Thread>;
    $patch: Endpoint<PathId & { json: UpdateThreadRequest }, Thread>;
    $delete: Endpoint<PathId, { ok: true }>;
  };
  /** Opens a file or directory from the thread workspace in the user's editor.
   *  The request path is relative to the workspace root and can include editor
   *  and target preferences. */
  "/threads/:id/open-path": {
    $post: Endpoint<PathId & { json: OpenThreadPathRequest }, { ok: true }>;
  };
  "/threads/:id/default-execution-options": {
    $get: Endpoint<PathId, ThreadExecutionOptions | null>;
  };
  /** Lists files in a manager thread's internal workspace. Manager threads keep
   *  a separate working area for their own state outside the primary checkout. */
  "/threads/:id/manager-workspace/files": {
    $get: Endpoint<PathId, { files: Array<{ path: string; size: number }> }>;
  };
  /** Returns the content of a single file from a manager thread's internal
   *  workspace. */
  "/threads/:id/manager-workspace/file": {
    $get: Endpoint<PathId & { query: { path: string } }, { path: string; content: string }>;
  };
  /** Sends a prompt to a thread. Mode controls whether the server starts a new
   *  turn or steers the currently active turn when one exists. */
  "/threads/:id/tell": {
    $post: Endpoint<PathId & { json: TellThreadRequest }, { ok: true }>;
  };
  /** Queues a prompt for later delivery while the thread is busy. The queued
   *  message can be sent later through the companion /send route. */
  "/threads/:id/queue": {
    $post: Endpoint<PathId & { json: EnqueueThreadMessageRequest }, ThreadQueuedMessage, 201>;
  };
  /** Sends a previously queued message. Mode controls whether delivery starts a
   *  new turn or steers an already-running turn. */
  "/threads/:id/queue/:queuedMessageId/send": {
    $post: Endpoint<
      PathThreadAndQueued & { json: SendQueuedThreadMessageRequest },
      SendQueuedThreadMessageResponse
    >;
  };
  "/threads/:id/queue/:queuedMessageId": {
    $delete: Endpoint<PathThreadAndQueued, { ok: true }>;
  };
  "/threads/:id/stop": {
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/threads/:id/archive": {
    $post: Endpoint<PathId & { json: { force?: boolean } }, { ok: true }>;
  };
  "/threads/:id/unarchive": {
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/threads/:id/read": {
    $post: Endpoint<PathId, Thread>;
  };
  "/threads/:id/unread": {
    $post: Endpoint<PathId, Thread>;
  };
  "/threads/:id/work-status": {
    $get: Endpoint<PathId & { query?: { mergeBaseBranch?: string } }, ThreadWorkStatus | null>;
  };
  /** Returns candidate merge-base branches for git diff comparisons. */
  "/threads/:id/merge-base-branches": {
    $get: Endpoint<PathId, string[]>;
  };
  /** Returns the primary-checkout ownership metadata for the thread's project,
   *  including which environment is currently active in the editor. */
  "/threads/:id/primary-status": {
    $get: Endpoint<PathId, PrimaryCheckoutStatus>;
  };
  "/threads/:id/timeline": {
    $get: Endpoint<
      PathId & {
        query?: {
          limit?: string;
          includeToolGroupMessages?: "true" | "false";
          includeManagerDebugView?: "true" | "false";
        };
      },
      ThreadTimelineResponse
    >;
  };
  /** Lazily loads detailed tool call and tool response messages for a specific
   *  collapsed tool group within a turn. */
  "/threads/:id/tool-group-messages": {
    $get: Endpoint<
      PathId & {
        query: {
          turnId: string;
          sourceSeqStart: string;
          sourceSeqEnd: string;
          includeManagerDebugView?: "true" | "false";
        };
      },
      ThreadToolGroupMessagesResponse
    >;
  };
  "/threads/:id/git-diff": {
    $get: Endpoint<
      PathId & {
        query?: {
          selection?: "combined" | "commit";
          commitSha?: string;
          mergeBaseBranch?: string;
        };
      },
      ThreadGitDiffResponse
    >;
  };
  "/threads/:id/events": {
    $get: Endpoint<PathId & { query?: { afterSeq?: string; limit?: string } }, ThreadEventRow[]>;
  };
  /** Returns the thread's final output string, or null if the thread has not
   *  produced a terminal output yet. */
  "/threads/:id/output": {
    $get: Endpoint<PathId, { output: string | null }>;
  };
  "/system/status": {
    $get: Endpoint<EmptyInput, SystemStatus>;
  };
  "/system/health": {
    $get: Endpoint<EmptyInput, SystemHealthReport>;
  };
  "/system/models": {
    $get: Endpoint<
      { query?: { providerId?: string; environmentId?: string } },
      AvailableModel[]
    >;
  };
  "/system/provider": {
    $get: Endpoint<{ query?: { environmentId?: string } }, SystemProviderInfo>;
  };
  "/system/providers": {
    $get: Endpoint<{ query?: { environmentId?: string } }, SystemProviderInfo[]>;
  };
  "/system/environments": {
    $get: Endpoint<EmptyInput, SystemEnvironmentInfo[]>;
  };
  "/system/restart-policy": {
    $get: Endpoint<EmptyInput, SystemRestartPolicy>;
  };
  "/system/shutdown": {
    $post:
      | Endpoint<{ json: SystemShutdownRequest }, SystemShutdownAcceptedResponse, 200>
      | Endpoint<{ json: SystemShutdownRequest }, SystemShutdownBlockedResponse, 409>;
  };
  "/system/restart": {
    $post:
      | Endpoint<{ json: SystemRestartRequest }, SystemRestartAcceptedResponse, 200>
      | Endpoint<{ json: SystemRestartRequest }, SystemShutdownBlockedResponse, 409>;
  };
  /** Opens the OS-native folder picker and returns the selected absolute path,
   *  or null when the user cancels the dialog. */
  "/system/pick-folder": {
    $post: Endpoint<EmptyInput, { path: string | null }>;
  };
  /** Opens an absolute file or directory path in the user's editor, with the
   *  same editor preference options as the thread-scoped open-path route. */
  "/system/open-path": {
    $post: Endpoint<{ json: OpenPathRequest }, { ok: true }>;
  };
  "/system/voice-transcription": {
    $post: Endpoint<{ form: Record<string, string | Blob> }, SystemVoiceTranscriptionResponse>;
  };
};

export type PublicApiRoutes = Hono<{}, PublicApiSchema, "/">;

export function createPublicApiClient(baseUrl: string) {
  return hc<PublicApiRoutes>(`${baseUrl}/api/v1`);
}

export function createApiClient(baseUrl: string) {
  const apiClient = createPublicApiClient(baseUrl);
  return {
    api: {
      v1: apiClient,
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
