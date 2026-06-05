import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Pill } from "./pill";
import { EmptyStatePanel } from "./empty-state";

/**
 * The token + states preview. This is the single surface where the design
 * system's *relationships* are visible at once — every neutral surface, every
 * interactive state, and the live primitives, each shown on both the page
 * background and a card. Toggle Ladle's light/dark switch to compare modes.
 *
 * Use it as an audit board: after any token change, a surface that collapses
 * into its neighbour, a state that reads too strong/too faint, or a control
 * that clashes with white shows up here immediately — instead of being found
 * one screen at a time in the running app.
 */
export default {
  title: "ui/Theme Tokens",
};

// --- helpers ---------------------------------------------------------------

function Swatch({
  token,
  className,
  variant = "fill",
}: {
  token: string;
  className: string;
  variant?: "fill" | "border";
}) {
  return (
    <div className="flex w-20 flex-col items-center gap-1">
      <div
        className={cn(
          "size-14 rounded-md",
          variant === "border"
            ? cn("border-2 bg-background", className)
            : cn("border border-border/40", className),
        )}
      />
      <span className="text-center text-[11px] leading-tight text-muted-foreground">
        {token}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-6">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

/** Renders the same sample against both the page background and a card. */
function OnBothSurfaces({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {(
        [
          ["on background", "bg-background"],
          ["on card", "bg-card"],
        ] as const
      ).map(([label, surface]) => (
        <div key={label} className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
          <div className={cn("rounded-lg border border-border p-4", surface)}>
            {children}
          </div>
        </div>
      ))}
    </div>
  );
}

const INTERACTIVE_STATES: readonly (readonly [string, string])[] = [
  ["rest", ""],
  ["hover", "bg-state-hover text-foreground"],
  ["active", "bg-state-active text-foreground"],
  ["selected", "bg-surface-selected border border-surface-selected-border"],
];

function StateRows() {
  return (
    <div className="flex flex-col gap-1.5">
      {INTERACTIVE_STATES.map(([label, cls]) => (
        <div
          key={label}
          className={cn(
            "flex items-center justify-between rounded-md px-3 py-2 text-sm",
            cls,
          )}
        >
          <span>List row — {label}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {cls.split(" ")[0] || "transparent"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Primitives() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="default" size="sm">
          Default
        </Button>
        <Button variant="outline" size="sm">
          Outline
        </Button>
        <Button variant="secondary" size="sm">
          Secondary
        </Button>
        <Button variant="ghost" size="sm">
          Ghost
        </Button>
        <Button variant="destructive" size="sm">
          Destructive
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill variant="outline">outline</Pill>
        <Pill variant="secondary">secondary</Pill>
        <Pill variant="default">default</Pill>
        <Pill variant="emphasis">emphasis</Pill>
      </div>
      <Input placeholder="Input field" className="h-8 text-xs" />
      <EmptyStatePanel className="text-xs">
        Empty state placeholder
      </EmptyStatePanel>
    </div>
  );
}

function StatusSwatch({
  token,
  fill,
  fg,
}: {
  token: string;
  fill: string;
  fg: string;
}) {
  return (
    <div
      className={cn(
        "flex h-14 w-24 items-center justify-center rounded-md text-xs font-medium",
        fill,
        fg,
      )}
    >
      {token}
    </div>
  );
}

// --- stories ---------------------------------------------------------------

/** The neutral elevation ramp. Adjacent swatches should be distinguishable. */
function NeutralSurfaces() {
  return (
    <Section title="Neutral surfaces (elevation ramp)">
      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-background p-6">
        <Swatch token="background" className="bg-background" />
        <Swatch token="card" className="bg-card" />
        <Swatch token="popover" className="bg-popover" />
        <Swatch token="sidebar" className="bg-sidebar" />
        <Swatch token="secondary" className="bg-secondary" />
        <Swatch token="accent" className="bg-accent" />
        <Swatch token="muted" className="bg-muted" />
        <Swatch token="surface-raised" className="bg-surface-raised" />
        <Swatch token="surface-recessed" className="bg-surface-recessed" />
        <Swatch token="border" className="border-border" variant="border" />
        <Swatch token="input" className="border-input" variant="border" />
      </div>
    </Section>
  );
}

/**
 * Interactive fills, shown statically on both surfaces. Each state should read
 * clearly against both background and card; selected should sit a clear step
 * apart from hover/active.
 */
function InteractiveStates() {
  return (
    <Section title="Interactive states">
      <OnBothSurfaces>
        <StateRows />
      </OnBothSurfaces>
    </Section>
  );
}

/** Live primitives on both surfaces — catches fills/borders that clash. */
function LivePrimitives() {
  return (
    <Section title="Live primitives">
      <OnBothSurfaces>
        <Primitives />
      </OnBothSurfaces>
    </Section>
  );
}

/** Status and accent colors with their paired foregrounds. */
function StatusAndAccent() {
  return (
    <Section title="Status & accent">
      <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-background p-6">
        <StatusSwatch token="primary" fill="bg-primary" fg="text-primary-foreground" />
        <StatusSwatch
          token="destructive"
          fill="bg-destructive"
          fg="text-destructive-foreground"
        />
        <StatusSwatch
          token="warning"
          fill="bg-warning"
          fg="text-warning-foreground"
        />
        <StatusSwatch
          token="attention"
          fill="bg-attention"
          fg="text-attention-foreground"
        />
        <StatusSwatch
          token="success"
          fill="bg-success"
          fg="text-success-foreground"
        />
        <StatusSwatch token="diff-added" fill="bg-diff-added" fg="text-background" />
        <StatusSwatch
          token="diff-removed"
          fill="bg-diff-removed"
          fg="text-background"
        />
      </div>
    </Section>
  );
}

/** Everything on one board for a fast post-change scan. */
export function Overview() {
  return (
    <>
      <NeutralSurfaces />
      <InteractiveStates />
      <LivePrimitives />
      <StatusAndAccent />
    </>
  );
}
