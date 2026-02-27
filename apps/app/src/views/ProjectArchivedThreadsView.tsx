import { Link, useParams } from "react-router-dom";
import { PageShell } from "@/components/layout/PageShell";
import { useThreads } from "@/hooks/useApi";
import { formatRelativeTime } from "@/lib/formatting";

export function ProjectArchivedThreadsView() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: threads, isLoading } = useThreads(
    {
      projectId,
      includeArchived: true,
    },
    { enabled: Boolean(projectId) },
  );

  if (!projectId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">Project not found</p>
      </PageShell>
    );
  }

  const archivedThreads =
    threads
      ?.filter((thread) => thread.archivedAt !== undefined && thread.parentThreadId === undefined)
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)) ?? [];

  return (
    <PageShell contentClassName="pt-8 md:pt-10">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading archived threads…</p>
        ) : archivedThreads.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No archived threads yet.
          </p>
        ) : (
          <div className="space-y-1">
            {archivedThreads.map((thread) => (
              <Link
                key={thread.id}
                to={`/projects/${projectId}/threads/${thread.id}`}
                className="flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">
                  {thread.title ?? `Thread ${thread.id.slice(0, 8)}`}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatRelativeTime(thread.archivedAt ?? thread.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
