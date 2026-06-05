import type { ReactNode } from "react";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Pill } from "./pill";
import { EmptyStatePanel } from "./empty-state";

/**
 * The token audit board — every neutral surface, interactive state, status
 * color, and live primitive in one place, each rendered in both light and dark
 * at once so a token can be compared across modes without toggling the page
 * theme. Use it as an audit board after any token change: a surface that
 * collapses into its neighbour, a state that reads too strong/faint, or a
 * control that clashes shows up here immediately.
 */
export default {
  title: "Theme Tokens",
};

// --- helpers ---------------------------------------------------------------

const THEME_MODES: readonly string[] = ["light", "dark"];

/**
 * Renders the same sample forced into both light and dark, side by side. Each
 * pane re-declares its theme tokens locally (via the `.light` / `.dark` class),
 * so both modes show regardless of the page theme.
 */
function DualTheme({ children }: { children: ReactNode }) {
  return (
    <div className="grid w-full grid-cols-2 gap-3">
      {THEME_MODES.map((mode) => (
        <div
          key={mode}
          className={cn(
            mode,
            "flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background p-3 text-foreground",
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}

/** Renders the same sample against both the page background and a card. */
function OnBothSurfaces({ children }: { children: ReactNode }) {
  return (
    <div className="grid w-full grid-cols-2 gap-3">
      {(
        [
          ["on background", "bg-background"],
          ["on card", "bg-card"],
        ] as const
      ).map(([label, surface]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {label}
          </span>
          <div className={cn("rounded-md border border-border p-3", surface)}>
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
    <div className="flex flex-col gap-1">
      {INTERACTIVE_STATES.map(([label, cls]) => (
        <div
          key={label}
          className={cn(
            "flex items-center justify-between rounded-md px-3 py-1.5 text-xs",
            cls,
          )}
        >
          <span>List row — {label}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {cls.split(" ")[0] || "transparent"}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A solid color swatch with its token name beneath — the same labelled-chip
 *  shape used elsewhere on the board, for auditing the semantic palette. */
function Swatch({ token, fill }: { token: string; fill: string }) {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      <div className={cn("h-11 w-full rounded-md border border-border", fill)} />
      <span className="text-center text-[10px] leading-tight text-muted-foreground">
        {token}
      </span>
    </div>
  );
}

/** A small surface label, colored with that surface's own paired foreground
 *  token so the board audits each surface/foreground pairing directly. */
function SurfaceTag({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("text-[10px] font-medium", className)}>{children}</span>
  );
}

/**
 * A realistic slice of app chrome: the sidebar against the page background,
 * with a card and a floating popover. Shows the structural surfaces in the
 * relationships they actually appear in, so "sidebar vs background" or "card vs
 * popover" reads as a real elevation rather than an abstract swatch.
 */
function SurfaceWidget() {
  return (
    <div className="flex h-44 overflow-hidden rounded-lg border border-border shadow-sm">
      <div className="flex w-36 flex-col gap-1 bg-sidebar p-2 text-sidebar-foreground">
        <SurfaceTag className="text-sidebar-foreground">sidebar</SurfaceTag>
        <div className="rounded border border-surface-selected-border bg-surface-selected px-2 py-1 text-[10px]">
          Active item
        </div>
        <div className="rounded bg-state-hover px-2 py-1 text-[10px]">
          Hovered item
        </div>
        <div className="px-2 py-1 text-[10px] text-muted-foreground">Item</div>
        <div className="px-2 py-1 text-[10px] text-muted-foreground">Item</div>
      </div>
      <div className="relative flex-1 bg-background p-3 text-foreground">
        <SurfaceTag className="text-foreground">background</SurfaceTag>
        <div className="mt-2 rounded-md border border-border bg-card p-2 text-card-foreground shadow-xs">
          <SurfaceTag className="text-card-foreground">card</SurfaceTag>
          <div className="mt-1.5 h-1.5 w-3/4 rounded-full bg-muted" />
          <div className="mt-1 h-1.5 w-1/2 rounded-full bg-secondary" />
        </div>
        <div className="absolute right-3 bottom-3 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[10px] text-popover-foreground shadow-md">
          popover
        </div>
      </div>
    </div>
  );
}

/** Contiguous elevation ramp — segments touch so adjacent steps are directly
 *  comparable (a collapsed step is immediately visible). */
const RAMP: readonly (readonly [string, string])[] = [
  ["background", "bg-background"],
  ["sidebar", "bg-sidebar"],
  ["card", "bg-card"],
  ["popover", "bg-popover"],
  ["secondary", "bg-secondary"],
  ["accent", "bg-accent"],
  ["muted", "bg-muted"],
];

function RampBar() {
  return (
    <div className="w-full">
      <div className="flex overflow-hidden rounded-md border border-border">
        {RAMP.map(([token, cls]) => (
          <div key={token} className={cn("h-10 flex-1", cls)} />
        ))}
      </div>
      <div className="mt-1 flex">
        {RAMP.map(([token]) => (
          <span
            key={token}
            className="flex-1 text-center text-[9px] leading-tight text-muted-foreground"
          >
            {token}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A labelled cluster of equal-size chips within a row. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">
        {title}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** One labelled chip, sized consistently across Lines and Overlays. */
function Chip({ token, children }: { token: string; children: ReactNode }) {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      <div className="flex size-11 items-center justify-center rounded-md border border-border bg-card">
        {children}
      </div>
      <span className="text-center text-[10px] leading-tight text-muted-foreground">
        {token}
      </span>
    </div>
  );
}

/** A border token shown as a framed swatch (its real use: a stroke). */
function LineChip({ token, className }: { token: string; className: string }) {
  return (
    <Chip token={token}>
      <div className={cn("size-7 rounded border-2 bg-transparent", className)} />
    </Chip>
  );
}

/** A translucent overlay token, composited on the card chip (its real use). */
function OverlayChip({ token, className }: { token: string; className: string }) {
  return (
    <Chip token={token}>
      <div className={cn("size-7 rounded", className)} />
    </Chip>
  );
}

function Primitives() {
  return (
    <div className="flex flex-col gap-2">
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
      <EmptyStatePanel className="text-xs">Empty state placeholder</EmptyStatePanel>
    </div>
  );
}

// --- story -----------------------------------------------------------------

/** Everything on one board, one row per concept, each shown in both modes. */
export function Overview() {
  return (
    <StoryCard labelWidth="150px">
      <StoryRow
        label="Neutral surfaces"
        hint="Structural surfaces in context, then the contiguous elevation ramp — adjacent steps should stay distinguishable."
      >
        <DualTheme>
          <SurfaceWidget />
          <RampBar />
        </DualTheme>
      </StoryRow>

      <StoryRow
        label="Lines & overlays"
        hint="Borders are strokes; overlays are translucent (shown on a card)."
      >
        <DualTheme>
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <Group title="Lines">
              <LineChip token="hairline" className="border-border-hairline" />
              <LineChip token="border" className="border-border" />
              <LineChip token="input" className="border-input" />
            </Group>
            <Group title="Overlays (on card)">
              <OverlayChip token="surface-raised" className="bg-surface-raised" />
              <OverlayChip
                token="surface-recessed"
                className="bg-surface-recessed"
              />
            </Group>
          </div>
        </DualTheme>
      </StoryRow>

      <StoryRow
        label="Interactive states"
        hint="Each should read clearly on both surfaces; selected sits a step apart."
      >
        <DualTheme>
          <OnBothSurfaces>
            <StateRows />
          </OnBothSurfaces>
        </DualTheme>
      </StoryRow>

      <StoryRow
        label="Status & accent"
        hint="The semantic palette — each should stay distinct from the others and from the neutral ramp."
      >
        <DualTheme>
          <div className="flex flex-wrap gap-2">
            <Swatch token="primary" fill="bg-primary" />
            <Swatch token="destructive" fill="bg-destructive" />
            <Swatch token="warning" fill="bg-warning" />
            <Swatch token="attention" fill="bg-attention" />
            <Swatch token="success" fill="bg-success" />
            <Swatch token="diff-added" fill="bg-diff-added" />
            <Swatch token="diff-removed" fill="bg-diff-removed" />
          </div>
        </DualTheme>
      </StoryRow>

      <StoryRow label="Live primitives" hint="Catches fills/borders that clash on a surface.">
        <DualTheme>
          <OnBothSurfaces>
            <Primitives />
          </OnBothSurfaces>
        </DualTheme>
      </StoryRow>
    </StoryCard>
  );
}
