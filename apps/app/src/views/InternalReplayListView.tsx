import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/layout/PageShell";
import {
  SettingsRow,
  SettingsRowList,
} from "@/components/settings/SettingsRow";
import * as api from "@/lib/api";

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function InternalReplayListView() {
  const capturesQuery = useQuery({
    queryKey: ["internal-replay-captures"],
    queryFn: () => api.listReplayCaptures(),
  });

  const captures = capturesQuery.data?.captures ?? [];

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">
            Replay captured threads
          </h1>
          <p className="text-sm text-muted-foreground">
            <code className="font-mono text-xs">
              BB_DEV_REPLAY_CAPTURE=true pnpm dev
            </code>
          </p>
        </div>
        {capturesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : capturesQuery.isError ? (
          <p className="text-sm text-destructive">
            Failed to load replay captures.
          </p>
        ) : captures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No replay captures found on any connected host.
          </p>
        ) : (
          <SettingsRowList>
            {captures.map((capture) => {
              const title = capture.title ?? capture.captureId;
              const projectName = capture.projectName ?? capture.projectId;
              return (
                <SettingsRow key={`${capture.hostId}:${capture.captureId}`}>
                  <Link
                    to={`/development-only/replay/${capture.captureId}`}
                    className="flex min-w-0 flex-1 items-center gap-3 hover:underline"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {title}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {projectName} · {capture.providerId}
                      </span>
                    </span>
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(capture.capturedAt)}
                  </span>
                </SettingsRow>
              );
            })}
          </SettingsRowList>
        )}
      </div>
    </PageShell>
  );
}
