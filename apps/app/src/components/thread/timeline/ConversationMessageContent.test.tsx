// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationMessageContent } from "./ConversationMessageContent";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConversationMessageContent", () => {
  it("routes assistant web links through onOpenLink and prevents default", () => {
    const onOpenLink = vi.fn(() => true);
    render(
      <ConversationMessageContent
        role="assistant"
        attachments={null}
        text="[Docs](https://example.com/docs)"
        turnRequest={null}
        onOpenLink={onOpenLink}
      />,
    );

    const link = screen.getByRole("link", { name: "Docs" });
    const notDefaultPrevented = fireEvent.click(link);

    expect(onOpenLink).toHaveBeenCalledTimes(1);
    expect(onOpenLink).toHaveBeenCalledWith({
      href: "https://example.com/docs",
    });
    expect(notDefaultPrevented).toBe(false);
  });

  it("renders user message content as plain text with no link surface", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="user"
        senderThreadId={null}
        senderThreadTitle={null}
        attachments={null}
        text="Visit https://example.com/docs"
        turnRequest={{ kind: "message", status: "accepted" }}
      />,
    );

    // User messages are plain text (CollapsibleMessageText), never markdown —
    // so there is no anchor to route, which is why `onOpenLink` is assistant
    // only and the user variant does not accept it.
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText("Visit https://example.com/docs"),
    ).toBeTruthy();
  });

  it("renders agent-originated messages as expandable timeline rows and hides bb reply guidance", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="agent"
        resolveSegmentLinkHref={(link) => {
          switch (link.kind) {
            case "thread":
              return `/projects/proj_123/threads/${link.threadId}`;
          }
        }}
        senderThreadId="thr_sender123"
        senderThreadTitle="Frontend manager"
        attachments={null}
        text={
          '[bb message from thread:thr_sender123; reply with `bb thread tell thr_sender123 "<your response>"`]\n\nLine 1\nLine 2\nLine 3\nLine 4'
        }
        turnRequest={{ kind: "message", status: "accepted" }}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /Message from Frontend manager/u,
      }),
    ).toBeTruthy();
    const senderLink = screen.getByRole("link", {
      name: "Frontend manager",
    });
    expect(senderLink.getAttribute("href")).toBe(
      "/projects/proj_123/threads/thr_sender123",
    );
    expect(screen.queryByText(/Line 4/u)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Message from Frontend manager/u,
      }),
    );

    expect(screen.queryByText("thr_sender123")).toBeNull();
    expect(screen.queryByText(/\[bb message from thread/u)).toBeNull();
    expect(screen.queryByText(/bb thread tell/u)).toBeNull();
    expect(screen.getByText(/Line 4/u)).toBeTruthy();
  });

  it("renders system-originated messages as expandable timeline rows and hides the bb prefix", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="system"
        senderThreadId={null}
        senderThreadTitle={null}
        attachments={null}
        text={"[bb system]\n\nScheduled nudge: daily-recap. Check ASYNC.md."}
        turnRequest={{ kind: "message", status: "accepted" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: /System Message/u }),
    ).toBeTruthy();
    expect(
      screen.queryByText("Scheduled nudge: daily-recap. Check ASYNC.md."),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /System Message/u }),
    );

    expect(
      screen.getByText("Scheduled nudge: daily-recap. Check ASYNC.md."),
    ).toBeTruthy();
    expect(screen.queryByText(/\[bb system/u)).toBeNull();
  });
});
