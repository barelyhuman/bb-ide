import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { DetailCard, DetailRow } from "@bb/ui-core";
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
  const heading = capture?.title ?? captureId;

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{heading}</h1>
          <p className="text-sm text-muted-foreground">
            <code className="font-mono text-xs">{captureId}</code>
          </p>
        </div>

        {captureQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading capture...</p>
        ) : captureQuery.isError ? (
          <p className="text-sm text-destructive">
            Failed to load replay capture.
          </p>
        ) : capture ? (
          <div className="space-y-4">
            <DetailCard>
              <DetailRow label="Host" valueClassName="min-w-0 truncate">
                {capture.hostId}
              </DetailRow>
              <DetailRow label="Provider" valueClassName="min-w-0 truncate">
                {capture.providerId}
              </DetailRow>
              <DetailRow label="Project" valueClassName="min-w-0 truncate">
                {capture.projectName ?? capture.projectId}
              </DetailRow>
              <DetailRow label="Thread" valueClassName="min-w-0 truncate">
                {capture.threadId}
              </DetailRow>
              <DetailRow label="Captured" valueClassName="min-w-0 truncate">
                {formatDate(capture.capturedAt)}
              </DetailRow>
              <DetailRow label="Raw events" valueClassName="min-w-0 truncate">
                {capture.eventCounts.rawProviderEvents}
              </DetailRow>
            </DetailCard>

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
              <p className="text-sm text-destructive">
                Failed to start replay.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
