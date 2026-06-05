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
  "card",
  "popover",
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

      it("keeps card and popover at the same elevation", () => {
        expect(step("card")).toBe(step("popover"));
      });

      it("orders fills below borders below input", () => {
        for (const fill of ["card", "secondary", "accent", "muted", "state-hover"]) {
          expect(step(fill)).toBeLessThan(step("border"));
        }
        expect(step("card")).toBeLessThan(step("muted"));
        expect(step("border")).toBeLessThanOrEqual(step("input"));
      });

      it("makes the pressed/selected fill stronger than hover", () => {
        expect(step("state-active")).toBeGreaterThan(step("state-hover"));
        expect(step("sidebar-accent")).toBeGreaterThan(step("sidebar"));
      });

      it("keeps the sidebar quieter than cards in both modes", () => {
        // Sidebar is chrome adjacent to the background; a card is a raised panel
        // above it. This ordering must hold in light and dark so the elevation
        // ramp stays monotonic (it used to invert between modes).
        expect(step("sidebar")).toBeLessThan(step("card"));
      });
    });
  }

  it("defines the same ramp tokens in light and dark", () => {
    const light = [...rampSteps(modeBlock("light")).keys()].sort();
    const dark = [...rampSteps(modeBlock("dark")).keys()].sort();
    expect(light).toEqual(dark);
  });
});
