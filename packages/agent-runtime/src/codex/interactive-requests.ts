import type { CommandExecutionRequestApprovalResponse } from "./generated/codex-app-server/schema/v2/CommandExecutionRequestApprovalResponse.js";
import type { FileChangeRequestApprovalResponse } from "./generated/codex-app-server/schema/v2/FileChangeRequestApprovalResponse.js";
import type { PermissionsRequestApprovalResponse } from "./generated/codex-app-server/schema/v2/PermissionsRequestApprovalResponse.js";
import type {
  DecodedInteractiveRequest,
  JsonRpcMessage,
  ProviderAdapter,
} from "../provider-adapter.js";
import { ProviderRequestDecodeError as ProviderRequestDecodeErrorValue } from "../provider-adapter.js";
import {
  parseCodexAvailableDecisions,
  pendingInteractionToCodexFileChangeApprovalDecision,
  toCodexCommandApprovalDecision,
  toCodexGrantedPermissionProfile,
  toPendingInteractionGrantablePermissionProfile,
} from "./permission-mapping.js";
import {
  codexCommandExecutionRequestApprovalParamsSchema,
  codexFileChangeRequestApprovalParamsSchema,
  codexPermissionsRequestApprovalParamsSchema,
} from "./schemas.js";

type BuildCodexInteractiveResponseArgs = Parameters<
  NonNullable<ProviderAdapter["buildInteractiveResponse"]>
>[0];

export type CodexInteractiveResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | PermissionsRequestApprovalResponse;

function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

function requireCommandSubject(command: string | null | undefined): string {
  if (!command) {
    throw new ProviderRequestDecodeErrorValue(
      "Command approval request did not include a command subject",
    );
  }
  return command;
}

export function decodeCodexInteractiveRequest(
  request: JsonRpcMessage,
): DecodedInteractiveRequest | null {
  if (typeof request.id !== "string" && typeof request.id !== "number") {
    return null;
  }

  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const parsed = codexCommandExecutionRequestApprovalParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      const availableDecisions = parseCodexAvailableDecisions(
        parsed.data.availableDecisions,
      );
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "command",
            itemId: parsed.data.itemId,
            command: requireCommandSubject(parsed.data.command),
            cwd: parsed.data.cwd ?? null,
          },
          reason: parsed.data.reason ?? null,
          grantablePermissions: parsed.data.additionalPermissions
            ? toPendingInteractionGrantablePermissionProfile(parsed.data.additionalPermissions)
            : null,
          availableDecisions,
        },
      };
    }
    case "item/fileChange/requestApproval": {
      const parsed = codexFileChangeRequestApprovalParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "file_change",
            itemId: parsed.data.itemId,
          },
          reason: parsed.data.reason ?? null,
          grantablePermissions: parsed.data.grantRoot
            ? {
                network: null,
                fileSystem: {
                  read: [],
                  write: [parsed.data.grantRoot],
                },
              }
            : null,
          availableDecisions: ["allow_once", "allow_for_session", "deny"],
        },
      };
    }
    case "item/permissions/requestApproval": {
      const parsed = codexPermissionsRequestApprovalParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      const permissions = toPendingInteractionGrantablePermissionProfile(
        parsed.data.permissions,
      );
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "permission_grant",
            itemId: parsed.data.itemId,
            toolName: null,
            permissions,
          },
          reason: parsed.data.reason,
          grantablePermissions: null,
          availableDecisions: ["allow_once", "allow_for_session", "deny"],
        },
      };
    }
    default:
      return null;
  }
}

export function buildCodexInteractiveResponse(
  args: BuildCodexInteractiveResponseArgs,
): CodexInteractiveResponse {
  switch (args.request.payload.kind) {
    case "approval": {
      if (args.resolution.kind !== "approval") {
        throw new Error("Interactive response kind mismatch for approval");
      }
      switch (args.request.payload.subject.kind) {
        case "command": {
          const response: CommandExecutionRequestApprovalResponse = {
            decision: toCodexCommandApprovalDecision(args.resolution.decision),
          };
          return response;
        }
        case "file_change": {
          const response: FileChangeRequestApprovalResponse = {
            decision:
              pendingInteractionToCodexFileChangeApprovalDecision[
                args.resolution.decision
              ],
          };
          return response;
        }
        case "permission_grant": {
          if (args.resolution.decision === "deny") {
            const response: PermissionsRequestApprovalResponse = {
              permissions: {},
              scope: "turn",
            };
            return response;
          }
          const response: PermissionsRequestApprovalResponse = {
            permissions: toCodexGrantedPermissionProfile(
              args.resolution.grantedPermissions
                ?? args.request.payload.subject.permissions,
            ),
            scope: args.resolution.decision === "allow_for_session"
              ? "session"
              : "turn",
          };
          return response;
        }
        default:
          return assertNever(args.request.payload.subject);
      }
    }
  }
}
