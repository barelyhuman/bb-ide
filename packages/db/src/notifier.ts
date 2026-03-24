import type { ThreadChangeKind, ProjectChangeKind, SystemChangeKind } from "@bb/domain";

export interface DbNotifier {
  notifyThread(threadId: string, changes: ThreadChangeKind[]): void;
  notifyProject(projectId: string, changes: ProjectChangeKind[]): void;
  notifySystem(changes: SystemChangeKind[]): void;
}

export const noopNotifier: DbNotifier = {
  notifyThread() {},
  notifyProject() {},
  notifySystem() {},
};
