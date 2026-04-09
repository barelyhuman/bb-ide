import { type ReactNode, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import { timeAgo } from "@bb/core-ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/layout/PageShell";
import { SettingsSection } from "@/components/settings/SettingsSection";
import {
  HostDeleteDialog,
  type HostDeleteDialogTarget,
} from "@/components/settings/HostDeleteDialog";
import {
  HostRenameDialog,
  type HostRenameDialogTarget,
} from "@/components/settings/HostRenameDialog";
import { setPreferredTheme, usePreferredTheme } from "@/hooks/useTheme";
import { useHosts } from "@/hooks/queries/system-queries";
import {
  allHostQueryKeyPrefix,
  hostsQueryKey,
  projectsQueryKey,
} from "@/hooks/queries/query-keys";
import * as api from "@/lib/api";

function SettingsWithControl({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="sm:flex sm:min-w-[320px] sm:justify-end">{children}</div>
    </div>
  );
}

const CONNECTED_DOT_CLASS =
  "bg-emerald-500 ring-emerald-500/25 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]";


export function AppSettingsView() {
  const theme = usePreferredTheme();
  const { data: hosts = [], isLoading: hostsLoading } = useHosts();
  const queryClient = useQueryClient();

  const [renameTarget, setRenameTarget] = useState<HostRenameDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HostDeleteDialogTarget | null>(null);

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
