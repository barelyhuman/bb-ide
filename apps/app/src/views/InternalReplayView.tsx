import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/layout/PageShell";
import * as api from "@/lib/api";

const DEFAULT_REPLAY_SPEED = 1;

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function InternalReplayView() {
  const { captureId = "" } = useParams();
  const navigate = useNavigate();
  const captureQuery = useQuery({
    queryKey: ["internal-replay-capture", captureId],
    queryFn: () => api.getReplayCapture(captureId),
    enabled: captureId.length > 0,
  });
  const startReplay = useMutation({
    mutationFn: () =>
      api.startReplayRun(captureId, {
        speed: DEFAULT_REPLAY_SPEED,
      }),
    onSuccess: (result) => {
      navigate(
        `/projects/${result.projectId}/threads/${result.replayThreadId}`,
      );
    },
  });

  const capture = captureQuery.data;

  return (
    <PageShell contentClassName="mx-auto w-full max-w-3xl gap-6 py-8">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          Development replay
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{captureId}</h1>
        <p className="text-sm text-muted-foreground">
          Create a fresh thread and stream this capture through the current host
          daemon replay path.
        </p>
      </div>

      {captureQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading capture...</p>
      ) : captureQuery.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load replay capture.
        </div>
      ) : capture ? (
        <div className="space-y-6 rounded-lg border bg-card p-5 shadow-sm">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Host</dt>
              <dd className="font-medium">{capture.hostId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Provider</dt>
              <dd className="font-medium">{capture.providerId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Project</dt>
              <dd className="font-medium">{capture.projectId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Original thread</dt>
              <dd className="font-medium">{capture.threadId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Captured</dt>
              <dd className="font-medium">{formatDate(capture.capturedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Raw provider events</dt>
              <dd className="font-medium">
                {capture.eventCounts.rawProviderEvents}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => startReplay.mutate()}
              disabled={
                startReplay.isPending ||
                capture.eventCounts.rawProviderEvents === 0
              }
            >
              Start replay
            </Button>
          </div>

          {startReplay.isError ? (
            <p className="text-sm text-destructive">Failed to start replay.</p>
          ) : null}
        </div>
      ) : null}
    </PageShell>
  );
}
