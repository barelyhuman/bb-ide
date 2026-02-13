import { useEffect, useMemo, useState } from "react";
import type { Task, TaskCloseReason, TaskStatus, UpdateTaskRequest } from "@beanbag/core";
import { useAssignTask, useCreateTask, useTask, useTasks, useUpdateTask } from "@/hooks/useApi";
import { TaskStatusBadge } from "@/components/shared/TaskStatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: TaskStatus[] = ["open", "in_progress", "blocked", "closed"];
const CLOSE_REASON_OPTIONS: TaskCloseReason[] = ["completed", "failed", "canceled"];

function formatRelativeTime(timestamp: number): string {
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;
  const elapsedWeeks = Math.floor(elapsedDays / 7);
  return `${elapsedWeeks}w ago`;
}

function statusLabel(status: TaskStatus): string {
  return status.replace("_", " ");
}

function closeReasonLabel(reason: TaskCloseReason): string {
  return reason;
}

function initializeDraft(task: Task | null) {
  return {
    status: task?.status ?? "open",
    closeReason: task?.closeReason ?? "completed",
    resultSummary: task?.resultSummary ?? "",
  } as {
    status: TaskStatus;
    closeReason: TaskCloseReason;
    resultSummary: string;
  };
}

export function ProjectTaskPanel({ projectId }: { projectId: string }) {
  const tasksQuery = useTasks({ projectId });
  const tasks = tasksQuery.data ?? [];
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const assignTask = useAssignTask();

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTaskQuery = useTask(selectedTaskId ?? "");
  const selectedTask = useMemo(
    () => selectedTaskQuery.data ?? tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, selectedTaskQuery.data, tasks],
  );

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [updateError, setUpdateError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigneeInput, setAssigneeInput] = useState("");

  const [draft, setDraft] = useState(() => initializeDraft(null));

  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId) {
      setSelectedTaskId(tasks[0].id);
      return;
    }
    const stillExists = tasks.some((task) => task.id === selectedTaskId);
    if (!stillExists) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    setDraft(initializeDraft(selectedTask));
    setUpdateError(null);
    setAssignError(null);
    setAssigneeInput("");
  }, [selectedTask?.id]);

  const submitCreate = async () => {
    const title = newTitle.trim();
    if (!title || createTask.isPending) return;

    setCreateError(null);
    try {
      const created = await createTask.mutateAsync({
        projectId,
        title,
        description: newDescription.trim() || undefined,
      });
      setSelectedTaskId(created.id);
      setNewTitle("");
      setNewDescription("");
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Unable to create task.",
      );
    }
  };

  const submitUpdate = async () => {
    if (!selectedTask || updateTask.isPending) return;

    const req: UpdateTaskRequest = {};
    if (draft.status !== selectedTask.status) req.status = draft.status;
    if (draft.resultSummary !== (selectedTask.resultSummary ?? "")) {
      req.resultSummary = draft.resultSummary;
    }
    if (draft.status === "closed") {
      if (!draft.closeReason) {
        setUpdateError("Close reason is required when status is closed.");
        return;
      }
      if (
        draft.closeReason !== selectedTask.closeReason ||
        req.status === "closed"
      ) {
        req.closeReason = draft.closeReason;
      }
    }

    if (Object.keys(req).length === 0) return;

    setUpdateError(null);
    try {
      const updated = await updateTask.mutateAsync({ id: selectedTask.id, req });
      setDraft(initializeDraft(updated));
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Unable to update task.",
      );
    }
  };

  const submitAssign = async () => {
    if (!selectedTask || assignTask.isPending) return;

    const assignee = assigneeInput.trim();
    if (!assignee) {
      setAssignError("Assignee is required.");
      return;
    }

    setAssignError(null);
    try {
      const updated = await assignTask.mutateAsync({ id: selectedTask.id, assignee });
      setDraft(initializeDraft(updated));
      setAssigneeInput("");
    } catch (error) {
      setAssignError(
        error instanceof Error ? error.message : "Unable to assign task.",
      );
    }
  };

  const statusOptions = selectedTask?.status === "closed"
    ? (["closed"] as TaskStatus[])
    : STATUS_OPTIONS;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Create Task</CardTitle>
          <CardDescription>Manual task entry for this project.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={newTitle}
            onChange={(event) => {
              setNewTitle(event.target.value);
              if (createError) setCreateError(null);
            }}
            placeholder="Task title"
          />
          <Textarea
            value={newDescription}
            onChange={(event) => setNewDescription(event.target.value)}
            placeholder="Description (optional)"
            className="min-h-20"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Tasks start as open and can be updated from the detail panel.
            </p>
            <Button
              onClick={() => {
                void submitCreate();
              }}
              disabled={createTask.isPending || newTitle.trim().length === 0}
            >
              {createTask.isPending ? "Creating..." : "Create task"}
            </Button>
          </div>
          {createError ? (
            <p className="text-sm text-destructive">{createError}</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Tasks</CardTitle>
            <CardDescription>
              {tasks.length} total in this project
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tasksQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading tasks...</p>
            ) : tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setSelectedTaskId(task.id)}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left transition-colors",
                      selectedTaskId === task.id
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
                      <TaskStatusBadge status={task.status} />
                    </div>
                    <p className="pt-1 text-xs text-muted-foreground">
                      {task.assignee ? `Assigned to ${task.assignee}` : "Unassigned"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Updated {formatRelativeTime(task.updatedAt)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Task Detail</CardTitle>
            <CardDescription>
              {selectedTask ? `Task ${selectedTask.id.slice(0, 8)}` : "Select a task"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedTask ? (
              <p className="text-sm text-muted-foreground">
                Select a task from the list to inspect and update it.
              </p>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{selectedTask.title}</p>
                    <TaskStatusBadge status={selectedTask.status} />
                  </div>
                  {selectedTask.description ? (
                    <p className="text-sm text-muted-foreground">{selectedTask.description}</p>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={draft.status}
                      onChange={(event) => {
                        const nextStatus = event.target.value as TaskStatus;
                        setDraft((current) => ({ ...current, status: nextStatus }));
                      }}
                    >
                      {statusOptions.map((option) => (
                        <option key={option} value={option}>
                          {statusLabel(option)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {draft.status === "closed" ? (
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Close reason</span>
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={draft.closeReason}
                        onChange={(event) => {
                          const nextReason = event.target.value as TaskCloseReason;
                          setDraft((current) => ({ ...current, closeReason: nextReason }));
                        }}
                      >
                        {CLOSE_REASON_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {closeReasonLabel(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>

                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">Result summary</span>
                  <Textarea
                    value={draft.resultSummary}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((current) => ({ ...current, resultSummary: value }));
                    }}
                    placeholder="Summary for closure or current outcome"
                    className="min-h-24"
                  />
                </label>

                <div className="flex items-center justify-end">
                  <Button
                    onClick={() => {
                      void submitUpdate();
                    }}
                    disabled={updateTask.isPending}
                  >
                    {updateTask.isPending ? "Saving..." : "Save updates"}
                  </Button>
                </div>
                {updateError ? (
                  <p className="text-sm text-destructive">{updateError}</p>
                ) : null}

                <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-sm font-medium">Assignment</p>
                  <p className="text-xs text-muted-foreground">
                    Current assignee: {selectedTask.assignee || "none"}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={assigneeInput}
                      onChange={(event) => {
                        setAssigneeInput(event.target.value);
                        if (assignError) setAssignError(null);
                      }}
                      placeholder="Assignee identity (for example user@local)"
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        void submitAssign();
                      }}
                      disabled={assignTask.isPending || selectedTask.status === "closed"}
                    >
                      {assignTask.isPending ? "Assigning..." : "Assign"}
                    </Button>
                  </div>
                  {assignError ? (
                    <p className="text-sm text-destructive">{assignError}</p>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
