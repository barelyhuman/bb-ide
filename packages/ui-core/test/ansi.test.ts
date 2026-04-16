import { describe, expect, it } from "vitest";
import { ansiToHtml } from "../src/thread-timeline/ansi.js";

describe("ansiToHtml", () => {
  it("uses contrast text variables for ANSI background colors", () => {
    expect(ansiToHtml("\u001b[46m RUN \u001b[49m done")).toBe(
      '<span style="background-color:var(--ansi-6);color:var(--ansi-bg-fg-6)"> RUN <span style="background-color:var(--background);color:var(--foreground)"> done</span></span>',
    );
  });

  it("lets background contrast override a previously selected foreground", () => {
    expect(ansiToHtml("\u001b[30m\u001b[45m @bb/server \u001b[49m\u001b[39m test")).toBe(
      '<span style="color:var(--ansi-0)"><span style="background-color:var(--ansi-5);color:var(--ansi-bg-fg-5)"> @bb/server <span style="background-color:var(--background);color:var(--foreground)"><span style="color:var(--foreground)"> test</span></span></span></span>',
    );
  });

  it("keeps escaped text escaped when adding background contrast", () => {
    expect(ansiToHtml("\u001b[45m<script>\u001b[49m")).toBe(
      '<span style="background-color:var(--ansi-5);color:var(--ansi-bg-fg-5)">&lt;script&gt;<span style="background-color:var(--background);color:var(--foreground)"></span></span>',
    );
  });
});
