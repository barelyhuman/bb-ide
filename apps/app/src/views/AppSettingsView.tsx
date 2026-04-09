import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import { timeAgo } from "@bb/core-ui";
import type {
  CloudAuthProviderId,
} from "@bb/server-contract";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/layout/PageShell";
import { CloudAuthSettingsSection } from "@/components/settings/CloudAuthSettingsSection";
import { SettingsSection } from "@/components/settings/SettingsSection";
import {
  SandboxEnvVarsSection,
  type SandboxEnvVarFormState,
} from "@/components/settings/SandboxEnvVarsSection";
import { SettingsWithControl } from "@/components/settings/SettingsWithControl";
import {
  HostDeleteDialog,
  type HostDeleteDialogTarget,
} from "@/components/settings/HostDeleteDialog";
import {
  HostRenameDialog,
  type HostRenameDialogTarget,
} from "@/components/settings/HostRenameDialog";
import { setPreferredTheme, usePreferredTheme } from "@/hooks/useTheme";
import {
  useCloudAuthAttempt,
  useCloudAuthSettings,
  useHosts,
  useSandboxEnvVars,
} from "@/hooks/queries/system-queries";
import {
  allHostQueryKeyPrefix,
  cloudAuthSettingsQueryKey,
  hostsQueryKey,
  projectsQueryKey,
  sandboxEnvVarsQueryKey,
} from "@/hooks/queries/query-keys";
import { sandboxHostSupportedAtom } from "@/lib/atoms";
import * as api from "@/lib/api";

const CONNECTED_DOT_CLASS =
  "bg-emerald-500 ring-emerald-500/25 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]";

interface CloudAuthAttemptState {
  attemptId: string;
  providerId: CloudAuthProviderId;
}

type CloudAuthNoticeMap = Partial<Record<CloudAuthProviderId, string>>;

export function AppSettingsView() {
  const theme = usePreferredTheme();
  const { data: hosts = [], isLoading: hostsLoading } = useHosts();
  const sandboxHostSupported = useAtomValue(sandboxHostSupportedAtom);
  const { data: cloudAuthSettings, isLoading: cloudAuthLoading } = useCloudAuthSettings(
    sandboxHostSupported,
  );
  const { data: sandboxEnvVars, isLoading: sandboxEnvLoading } = useSandboxEnvVars(
    sandboxHostSupported,
  );
  const queryClient = useQueryClient();

  const [renameTarget, setRenameTarget] = useState<HostRenameDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HostDeleteDialogTarget | null>(null);
  const [activeCloudAuthAttempt, setActiveCloudAuthAttempt] = useState<CloudAuthAttemptState | null>(
    null,
  );
  const [cloudAuthNotices, setCloudAuthNotices] = useState<CloudAuthNoticeMap>({});
  const [sandboxEnvForm, setSandboxEnvForm] = useState<SandboxEnvVarFormState>({
    name: "",
    value: "",
  });

  const activeCloudAuthStatus = useCloudAuthAttempt(
    activeCloudAuthAttempt?.attemptId ?? null,
    activeCloudAuthAttempt !== null,
  );

  const renameHost = useMutation({
    meta: {
      errorMessage: "Failed to rename host.",
    },
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.updateHost(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hostsQueryKey() });
      queryClient.invalidateQueries({ queryKey: allHostQueryKeyPrefix() });
      setRenameTarget(null);
    },
  });

  const deleteHost = useMutation({
    meta: {
      errorMessage: "Failed to remove host.",
    },
    mutationFn: ({ id }: { id: string }) => api.deleteHost(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hostsQueryKey() });
      queryClient.invalidateQueries({ queryKey: allHostQueryKeyPrefix() });
      queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
      setDeleteTarget(null);
    },
  });

  const startCloudAuthConnection = useMutation({
    meta: {
      errorMessage: "Failed to start cloud auth connection.",
    },
    mutationFn: (providerId: CloudAuthProviderId) =>
      api.startCloudAuthConnection(providerId),
    onSuccess: (result, providerId) => {
      setCloudAuthNotices((current) => ({
        ...current,
        [providerId]: "Opened the provider sign-in flow in your browser.",
      }));
      setActiveCloudAuthAttempt({
        attemptId: result.attemptId,
        providerId,
      });
      window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
    },
  });

  const disconnectCloudAuth = useMutation({
    meta: {
      errorMessage: "Failed to remove cloud auth connection.",
    },
    mutationFn: (providerId: CloudAuthProviderId) =>
      api.deleteCloudAuthProvider(providerId),
    onSuccess: (_, providerId) => {
      queryClient.invalidateQueries({ queryKey: cloudAuthSettingsQueryKey() });
      setCloudAuthNotices((current) => ({
        ...current,
        [providerId]: "Connection removed. The next sandbox sync will delete its auth material.",
      }));
      if (activeCloudAuthAttempt?.providerId === providerId) {
        setActiveCloudAuthAttempt(null);
      }
    },
  });

  const saveSandboxEnvVar = useMutation({
    meta: {
      errorMessage: "Failed to save sandbox env var.",
    },
    mutationFn: () =>
      api.upsertSandboxEnvVar({
        name: sandboxEnvForm.name.trim(),
        value: sandboxEnvForm.value,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sandboxEnvVarsQueryKey() });
      setSandboxEnvForm({
        name: "",
        value: "",
      });
    },
  });

  const deleteSandboxEnvVar = useMutation({
    meta: {
      errorMessage: "Failed to delete sandbox env var.",
    },
    mutationFn: (name: string) => api.deleteSandboxEnvVar(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sandboxEnvVarsQueryKey() });
    },
  });

  useEffect(() => {
    if (!activeCloudAuthAttempt || !activeCloudAuthStatus.data) {
      return;
    }

    const attempt = activeCloudAuthStatus.data;
    if (attempt.status === "pending") {
      return;
    }

    queryClient.invalidateQueries({ queryKey: cloudAuthSettingsQueryKey() });
    setCloudAuthNotices((current) => ({
      ...current,
      [attempt.providerId]:
        attempt.status === "completed"
          ? "Connection saved."
          : attempt.errorMessage ?? "Connection did not complete.",
    }));
    setActiveCloudAuthAttempt(null);
  }, [activeCloudAuthAttempt, activeCloudAuthStatus.data, queryClient]);

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <SettingsSection title="Appearance">
          <SettingsWithControl
            label="Theme"
            description="Choose your interface theme."
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between sm:w-48"
                  aria-label="Theme"
                >
                  {theme === "dark" ? "Dark" : "Light"}
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => setPreferredTheme("light")}>
                  Light
                  <Check className={theme === "light" ? "ml-auto size-4" : "ml-auto size-4 opacity-0"} />
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPreferredTheme("dark")}>
                  Dark
                  <Check className={theme === "dark" ? "ml-auto size-4" : "ml-auto size-4 opacity-0"} />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingsWithControl>
        </SettingsSection>

        {sandboxHostSupported ? (
          <>
            <CloudAuthSettingsSection
              activeAttemptProviderId={activeCloudAuthAttempt?.providerId ?? null}
              connectPending={startCloudAuthConnection.isPending}
              connections={cloudAuthSettings?.connections ?? []}
              disconnectPending={disconnectCloudAuth.isPending}
              isLoading={cloudAuthLoading}
              notices={cloudAuthNotices}
              onConnect={(providerId) => startCloudAuthConnection.mutate(providerId)}
              onDisconnect={(providerId) => disconnectCloudAuth.mutate(providerId)}
            />

            <SandboxEnvVarsSection
              deletePending={deleteSandboxEnvVar.isPending}
              envVars={sandboxEnvVars?.envVars ?? []}
              form={sandboxEnvForm}
              isLoading={sandboxEnvLoading}
              onDelete={(name) => deleteSandboxEnvVar.mutate(name)}
              onNameChange={(name) =>
                setSandboxEnvForm((current) => ({
                  ...current,
                  name,
                }))}
              onSave={() => saveSandboxEnvVar.mutate()}
              onValueChange={(value) =>
                setSandboxEnvForm((current) => ({
                  ...current,
                  value,
                }))}
              savePending={saveSandboxEnvVar.isPending}
            />
          </>
        ) : null}

        <SettingsSection title="Hosts">
          {hostsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : hosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No registered hosts.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {hosts.map((host) => {
                const isConnected = host.status === "connected";
                return (
                  <div
                    key={host.id}
                    className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {host.name}
                      <span className="ml-1.5 text-xs text-muted-foreground">{host.id}</span>
                    </span>
                    {isConnected ? (
                      <span
                        className={`size-2 shrink-0 rounded-full ring-1 ring-inset transition-all ${CONNECTED_DOT_CLASS}`}
                        title="Connected"
                      />
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Offline · {timeAgo(host.lastSeenAt)}
                      </span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          aria-label="Host actions"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onSelect={() =>
                            setRenameTarget({ id: host.id, currentName: host.name })
                          }
                        >
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() =>
                            setDeleteTarget({ id: host.id, name: host.name })
                          }
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </SettingsSection>
      </div>

      <HostRenameDialog
        target={renameTarget}
        pending={renameHost.isPending}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onRename={(id, name) => renameHost.mutate({ id, name })}
      />
      <HostDeleteDialog
        target={deleteTarget}
        pending={deleteHost.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDelete={(id) => deleteHost.mutate({ id })}
      />
    </PageShell>
  );
}
