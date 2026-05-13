// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  TimelineTitle,
  TimelineTitleAction,
  TimelineTitleDecoration,
  TimelineTitleSegment,
} from "@bb/thread-view";
import { TimelineTitleView } from "@/components/thread/timeline/TimelineTitleView";

interface TitleArgs {
  segments: TimelineTitleSegment[];
  decorations?: TimelineTitleDecoration[];
  tone?: TimelineTitle["tone"];
  action?: TimelineTitleAction | null;
  plain?: string;
}

function title({
  segments,
  decorations = [],
  tone = "default",
  action = null,
  plain,
}: TitleArgs): TimelineTitle {
  return {
    segments,
    decorations,
    tone,
    action,
    plain: plain ?? segments.map((s) => s.text).join(" "),
  };
}

function seg(
  text: string,
  opts: Partial<Omit<TimelineTitleSegment, "text">> = {},
): TimelineTitleSegment {
  return {
    text,
    em: opts.em ?? false,
    shimmer: opts.shimmer ?? false,
    truncate: opts.truncate ?? false,
    ...(opts.plainText !== undefined ? { plainText: opts.plainText } : {}),
  };
}

const fileDiffAction: TimelineTitleAction = {
  kind: "open-file-diff",
  path: "src/foo.ts",
};

afterEach(() => {
  cleanup();
});

describe("TimelineTitleView", () => {
  it("truncates the em segment while keeping non-em segments and decorations fixed", () => {
    const html = renderToStaticMarkup(
      <TimelineTitleView
        title={title({
          segments: [
            seg("Ran"),
            seg("pnpm exec turbo run test --filter=@bb/app", {
              em: true,
              truncate: true,
            }),
          ],
          decorations: [
            { kind: "duration", startedAt: 0, completedAt: 2_100, em: false },
          ],
          plain: "Ran pnpm exec turbo run test --filter=@bb/app 2s",
        })}
      />,
    );

    expect(html).toContain(">Ran</span>");
    expect(html).toContain(">pnpm exec turbo run test --filter=@bb/app</span>");
    expect(html).toContain(">2s</span>");
  });

  it("uses the full plain title as the browser title while rendering compact text", () => {
    const html = renderToStaticMarkup(
      <TimelineTitleView
        title={title({
          segments: [
            seg("Created"),
            seg("appSettingsAtoms.ts", {
              em: true,
              truncate: true,
              plainText: "apps/app/src/state/appSettingsAtoms.ts",
            }),
          ],
          decorations: [{ kind: "diff-stats", added: 16, removed: 0 }],
          plain: "Created apps/app/src/state/appSettingsAtoms.ts +16",
        })}
      />,
    );

    expect(html).toContain(
      'title="Created apps/app/src/state/appSettingsAtoms.ts +16"',
    );
    expect(html).toContain(">appSettingsAtoms.ts</span>");
    expect(html).not.toContain(
      ">apps/app/src/state/appSettingsAtoms.ts</span>",
    );
  });

  it("omits zero diff-stat sides", () => {
    const html = renderToStaticMarkup(
      <TimelineTitleView
        title={title({
          segments: [
            seg("Deleted"),
            seg("react-perf-audit.md", { em: true, truncate: true }),
          ],
          decorations: [{ kind: "diff-stats", added: 0, removed: 39 }],
          plain: "Deleted react-perf-audit.md -39",
        })}
      />,
    );

    expect(html).not.toContain("+0");
    expect(html).toContain("-39");
  });

  it("invokes the resolved callback on Enter and Space keypress", () => {
    const onAction = vi.fn();
    render(
      <TimelineTitleView
        title={title({
          segments: [seg("src/foo.ts", { em: true, truncate: true })],
          action: fileDiffAction,
        })}
        onTitleAction={() => onAction}
      />,
    );

    const link = screen.getByRole("link", { name: /src\/foo\.ts/ });
    fireEvent.keyDown(link, { key: "Enter" });
    fireEvent.keyDown(link, { key: " " });

    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("ticks live duration forward without re-rendering from the server", () => {
    vi.useFakeTimers();
    try {
      // Pretend the work started 2.1s ago: pin a fake "now" and put startedAt
      // 2_100ms before it. LiveDurationText reads `Date.now() - startedAt`.
      const fakeNow = 1_000_000;
      vi.setSystemTime(fakeNow);
      const startedAt = fakeNow - 2_100;
      const liveTitle = title({
        segments: [
          seg("Running", { shimmer: true }),
          seg("pnpm test", { em: true, truncate: true }),
        ],
        decorations: [
          { kind: "duration", startedAt, completedAt: null, em: false },
        ],
      });

      render(<TimelineTitleView title={liveTitle} />);

      expect(screen.getByText("2s")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(3_000);
      });

      // 2.1s baseline + 3s tick = 5.1s, formatted as "5s"
      expect(screen.getByText("5s")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops click and keyboard propagation so the surrounding row header doesn't toggle", () => {
    const onAction = vi.fn();
    const onWrapperClick = vi.fn();
    const onWrapperKeyDown = vi.fn();

    render(
      <div onClick={onWrapperClick} onKeyDown={onWrapperKeyDown}>
        <TimelineTitleView
          title={title({
            segments: [seg("src/foo.ts", { em: true, truncate: true })],
            action: fileDiffAction,
          })}
          onTitleAction={() => onAction}
        />
      </div>,
    );

    const link = screen.getByRole("link", { name: /src\/foo\.ts/ });
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: "Enter" });

    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onWrapperClick).not.toHaveBeenCalled();
    expect(onWrapperKeyDown).not.toHaveBeenCalled();
  });

  it("stops link click propagation so the row header doesn't toggle", () => {
    const onWrapperClick = vi.fn();

    render(
      <div onClick={onWrapperClick}>
        <TimelineTitleView
          title={title({
            segments: [
              {
                text: "Manager",
                em: true,
                shimmer: false,
                truncate: true,
                link: { kind: "thread", threadId: "thr_manager" },
              },
            ],
          })}
          resolveSegmentLinkHref={() => "/projects/p/threads/thr_manager"}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Manager" }));

    expect(onWrapperClick).not.toHaveBeenCalled();
  });
});
