import { timeAgo } from "@bb/core-ui";
import type {
  CloudAuthConnection,
  CloudAuthProviderId,
} from "@bb/server-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/SettingsSection";

const CLOUD_AUTH_STATUS_DISPLAY = {
  connected: {
    badgeVariant: "default",
    label: "Connected",
  },
  invalid: {
    badgeVariant: "destructive",
    label: "Needs attention",
  },
  missing: {
    badgeVariant: "outline",
    label: "Not connected",
  },
} satisfies Record<
  CloudAuthConnection["status"],
  {
    badgeVariant: "default" | "destructive" | "outline";
    label: string;
  }
>;

type CloudAuthNoticeMap = Partial<Record<CloudAuthProviderId, string>>;

interface CloudAuthRowProps {
  activeAttemptProviderId: CloudAuthProviderId | null;
  connection: CloudAuthConnection;
  connectPending: boolean;
  disconnectPending: boolean;
  notice: string | null;
  onConnect(providerId: CloudAuthProviderId): void;
  onDisconnect(providerId: CloudAuthProviderId): void;
}

function CloudAuthRow({
  activeAttemptProviderId,
  connection,
  connectPending,
  disconnectPending,
  notice,
  onConnect,
  onDisconnect,
}: CloudAuthRowProps) {
  const connectedTime = connection.lastRefreshedAt ?? connection.connectedAt;
  const isPendingAttempt = activeAttemptProviderId === connection.providerId;
  const canDisconnect = connection.status !== "missing";
  const statusDisplay = CLOUD_AUTH_STATUS_DISPLAY[connection.status];

  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{connection.displayName}</p>
          <Badge variant={statusDisplay.badgeVariant}>
            {statusDisplay.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {connection.label ?? "No account connected"}
          {connectedTime ? ` · Updated ${timeAgo(connectedTime)}` : ""}
        </p>
        {connection.errorMessage ? (
          <p className="text-xs text-destructive">{connection.errorMessage}</p>
        ) : null}
        {isPendingAttempt ? (
          <p className="text-xs text-muted-foreground">
            Waiting for browser sign-in to finish…
          </p>
        ) : null}
        {notice ? (
          <p className="text-xs text-muted-foreground">{notice}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={connectPending || disconnectPending}
          onClick={() => onConnect(connection.providerId)}
        >
          {connection.status === "missing" ? "Connect" : "Reconnect"}
        </Button>
        {canDisconnect ? (
          <Button
            size="sm"
            variant="outline"
            disabled={connectPending || disconnectPending}
            onClick={() => onDisconnect(connection.providerId)}
          >
            Disconnect
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface CloudAuthSettingsSectionProps {
  activeAttemptProviderId: CloudAuthProviderId | null;
  connectPending: boolean;
  connections: CloudAuthConnection[];
  disconnectPending: boolean;
  isLoading: boolean;
  notices: CloudAuthNoticeMap;
  onConnect(providerId: CloudAuthProviderId): void;
  onDisconnect(providerId: CloudAuthProviderId): void;
}

export function CloudAuthSettingsSection({
  activeAttemptProviderId,
  connectPending,
  connections,
  disconnectPending,
  isLoading,
  notices,
  onConnect,
  onDisconnect,
}: CloudAuthSettingsSectionProps) {
  return (
    <SettingsSection title="Cloud Auth">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="divide-y divide-border">
          {connections.map((connection) => (
            <CloudAuthRow
              key={connection.providerId}
              activeAttemptProviderId={activeAttemptProviderId}
              connection={connection}
              connectPending={connectPending}
              disconnectPending={disconnectPending}
              notice={notices[connection.providerId] ?? null}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
