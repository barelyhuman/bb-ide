import { timeAgo } from "@bb/core-ui";
import { sandboxEnvVarNameSchema, type SandboxEnvVar } from "@bb/server-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsWithControl } from "@/components/settings/SettingsWithControl";

export interface SandboxEnvVarFormState {
  name: string;
  value: string;
}

interface SandboxEnvVarsSectionProps {
  deletePending: boolean;
  envVars: SandboxEnvVar[];
  form: SandboxEnvVarFormState;
  isLoading: boolean;
  onDelete(name: string): void;
  onNameChange(name: string): void;
  onSave(): void;
  onValueChange(value: string): void;
  savePending: boolean;
}

function getSandboxEnvNameError(name: string): string | null {
  const trimmedName = name.trim();
  if (trimmedName === "") {
    return null;
  }

  return sandboxEnvVarNameSchema.safeParse(trimmedName).success
    ? null
    : "Use letters, numbers, and underscores, and do not start with a number.";
}

export function SandboxEnvVarsSection({
  deletePending,
  envVars,
  form,
  isLoading,
  onDelete,
  onNameChange,
  onSave,
  onValueChange,
  savePending,
}: SandboxEnvVarsSectionProps) {
  const nameError = getSandboxEnvNameError(form.name);
  const canSave =
    !savePending
    && form.name.trim() !== ""
    && form.value !== ""
    && nameError === null;

  return (
    <SettingsSection title="Sandbox Env Vars">
      <SettingsWithControl
        label="Global runtime env"
        description="These encrypted values are injected into cloud sandboxes and stay masked after save."
      >
        <div className="w-full space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : envVars.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No custom sandbox env vars saved.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {envVars.map((envVar) => (
                <div
                  key={envVar.name}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{envVar.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Value saved · Updated {timeAgo(envVar.updatedAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={deletePending}
                    onClick={() => onDelete(envVar.name)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input
              aria-label="Sandbox env var name"
              placeholder="VARIABLE_NAME"
              value={form.name}
              onChange={(event) => onNameChange(event.target.value)}
            />
            <Input
              aria-label="Sandbox env var value"
              placeholder="Value"
              type="password"
              value={form.value}
              onChange={(event) => onValueChange(event.target.value)}
            />
            <Button
              disabled={!canSave}
              onClick={onSave}
            >
              Save
            </Button>
          </div>
          {nameError ? (
            <p className="text-xs text-destructive">{nameError}</p>
          ) : null}
        </div>
      </SettingsWithControl>
    </SettingsSection>
  );
}
