import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the relational structure of the neutral ramp. The whole light/dark
 * palette is derived from two anchors per mode (`--canvas`, `--ink`) by mixing
 * ink into the canvas; each token's mix percentage is its *contrast from the
 * canvas*. These tests fail if someone reintroduces a hand-set literal, inverts
 * a state relationship, or adds a token to only one mode — the regressions that
 * the flat token set used to hide.
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "theme.css"),
  "utf8",
);

/** Declarations of the rule whose body contains `color-scheme: <scheme>;`. */
function modeBlock(scheme: "light" | "dark"): string {
  const at = css.indexOf(`color-scheme: ${scheme};`);
  if (at === -1) throw new Error(`no ${scheme} block in theme.css`);
  return css.slice(css.lastIndexOf("{", at) + 1, css.indexOf("}", at));
}

/**
 * token -> ink mix percentage, for tokens derived from the anchors. The base is
 * either the canvas (opaque steps) or `transparent` (translucent interactive/
 * overlay steps); over the canvas both resolve to the same step, so the mix
 * percentage is the comparable "contrast from canvas" either way.
 */
function rampSteps(block: string): Map<string, number> {
  const re =
    /--([a-z-]+):\s*color-mix\(in oklch, var\(--ink\) ([\d.]+)%, (?:var\(--canvas\)|transparent)\);/g;
  const steps = new Map<string, number>();
  for (const match of block.matchAll(re)) {
    steps.set(match[1], Number(match[2]));
  }
  return steps;
}

// Every neutral surface/line must be derived from the anchors, not hand-set.
const REQUIRED_RAMP_TOKENS = [
  "secondary",
  "accent",
  "muted",
  "state-hover",
  "state-active",
  "border",
  "border-hairline",
  "input",
  "sidebar",
  "sidebar-accent",
  "sidebar-border",
] as const;

const MODES = ["light", "dark"] as const;

describe("theme.css neutral ramp", () => {
  for (const mode of MODES) {
    describe(mode, () => {
      const block = modeBlock(mode);
      const steps = rampSteps(block);
      const step = (token: string): number => {
        const value = steps.get(token);
        if (value === undefined) throw new Error(`--${token} not derived`);
        return value;
      };

      it("defines the canvas and ink anchors", () => {
        expect(block).toMatch(/--canvas:\s*oklch\(/);
        expect(block).toMatch(/--ink:\s*oklch\(/);
      });

      it("derives every neutral-ramp token from the anchors", () => {
        for (const token of REQUIRED_RAMP_TOKENS) {
          expect(
            steps.has(token),
            `--${token} must derive from var(--ink)/var(--canvas), not a literal`,
          ).toBe(true);
        }
      });

      it("keeps card and popover flush with the background", () => {
        // Elevation is conveyed by border + shadow, not a surface tint, so card
        // and popover share the page's canvas value instead of sitting on the
        // lift ramp. Guards against anyone reintroducing a fill tint (the change
        // that silently broke sticky overlay headers).
        expect(steps.has("card")).toBe(false);
        expect(steps.has("popover")).toBe(false);
        expect(block).toMatch(/--card:\s*var\(--canvas\);/);
        expect(block).toMatch(/--popover:\s*var\(--canvas\);/);
      });

      it("orders fills below borders below input", () => {
        for (const fill of ["secondary", "accent", "muted", "state-hover"]) {
          expect(step(fill)).toBeLessThan(step("border"));
        }
        expect(step("border")).toBeLessThanOrEqual(step("input"));
      });

      it("makes the pressed/selected fill stronger than hover", () => {
        expect(step("state-active")).toBeGreaterThan(step("state-hover"));
        expect(step("sidebar-accent")).toBeGreaterThan(step("sidebar"));
      });

      it("keeps the sidebar a quiet chrome lift below the fills", () => {
        // Sidebar is chrome adjacent to the page, so it should be the faintest
        // lift — below the secondary/accent fills — and never compete with
        // content surfaces. This must hold in light and dark (the lift used to
        // invert between modes). Cards are now flush with the page, so the floor
        // this is measured against is the lowest fill rather than the card.
        expect(step("sidebar")).toBeLessThan(step("secondary"));
      });
    });
  }

  it("defines the same ramp tokens in light and dark", () => {
    const light = [...rampSteps(modeBlock("light")).keys()].sort();
    const dark = [...rampSteps(modeBlock("dark")).keys()].sort();
    expect(light).toEqual(dark);
  });
});
