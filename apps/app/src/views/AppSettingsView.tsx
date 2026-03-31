import { type ReactNode } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { setPreferredTheme, usePreferredTheme } from "@/hooks/useTheme";

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

export function AppSettingsView() {
  const theme = usePreferredTheme();

  return (
    <PageShell contentClassName="pt-8 md:pt-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pt-2">
        <SettingsWithControl
          label="Theme"
          description="Choose your interface theme."
        >
          <select
            aria-label="Theme"
            value={theme}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "light" || value === "dark") {
                setPreferredTheme(value);
              }
            }}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none ring-ring focus-visible:ring-2 sm:w-48"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </SettingsWithControl>
      </div>
    </PageShell>
  );
}
