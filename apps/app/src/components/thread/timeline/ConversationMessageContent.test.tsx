// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { USER_MESSAGE_CHAR_CAP } from "./conversation-message-limits";

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
        mentions={[]}
        text="Visit https://example.com/docs"
        turnRequest={{ kind: "message", status: "accepted" }}
      />,
    );

    // User messages are plain text (CollapsibleMessageText), never markdown —
    // so there is no anchor to route, which is why `onOpenLink` is assistant
    // only and the user variant does not accept it.
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Visit https://example.com/docs")).toBeTruthy();
  });

  it("renders user message thread mentions as router links", () => {
    render(
      <MemoryRouter>
        <ConversationMessageContent
          role="user"
          initiator="user"
          senderThreadId={null}
          senderThreadTitle={null}
          attachments={null}
          mentions={[
            {
              start: 4,
              end: 22,
              resource: {
                kind: "thread",
                threadId: "thr_manager",
                projectId: "proj_target",
                threadType: "manager",
                label: "Prompt UX manager",
              },
            },
          ]}
          projectId="proj_current"
          text="Ask @thread:thr_manager to review this."
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
    );

    // The mention type ("Manager") now renders as a leading icon, so the
    // pill's accessible name is the resource label; the full prefixed form
    // stays available as the title/tooltip.
    const mention = screen.getByRole("link", {
      name: "Prompt UX manager",
    });
    expect(mention.getAttribute("title")).toBe("Manager: Prompt UX manager");
    expect(mention.getAttribute("href")).toBe(
      "/projects/proj_target/threads/thr_manager",
    );
  });

  it("renders user message file mentions as display-only pills with full path hover title", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="user"
        senderThreadId={null}
        senderThreadTitle={null}
        attachments={null}
        mentions={[
          {
            start: 5,
            end: 26,
            resource: {
              kind: "path",
              source: "workspace",
              entryKind: "file",
              path: "apps/app/src/App.tsx",
              label: "App.tsx",
            },
          },
        ]}
        text="Open @apps/app/src/App.tsx"
        turnRequest={{ kind: "message", status: "accepted" }}
      />,
    );

    const pill = screen
      .getByText("App.tsx")
      .closest('[data-prompt-mention="true"]');
    expect(pill?.tagName).toBe("SPAN");
    expect(pill?.getAttribute("title")).toBe("apps/app/src/App.tsx");
    expect(screen.queryByRole("button", { name: "App.tsx" })).toBeNull();
    expect(screen.queryByRole("link", { name: "App.tsx" })).toBeNull();
  });

  it("clips user message text before a mention that crosses the visible boundary", () => {
    const token = "@partial-visible-thread-token";
    const visibleTokenLength = 8;
    const prefix = "x".repeat(USER_MESSAGE_CHAR_CAP - visibleTokenLength);
    const text = `${prefix}${token} after`;
    const start = text.indexOf(token);

    const { container } = render(
      <MemoryRouter>
        <ConversationMessageContent
          role="user"
          initiator="user"
          senderThreadId={null}
          senderThreadTitle={null}
          attachments={null}
          mentions={[
            {
              start,
              end: start + token.length,
              resource: {
                kind: "thread",
                threadId: "thr_boundary",
                projectId: "proj_boundary",
                threadType: "standard",
                label: "Boundary thread",
              },
            },
          ]}
          text={text}
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).not.toContain(
      token.slice(0, visibleTokenLength),
    );
    expect(screen.queryByRole("link", { name: "Boundary thread" })).toBeNull();
  });

  it("renders agent-originated messages as expandable timeline rows and hides bb reply guidance", () => {
    render(
      <MemoryRouter>
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
          mentions={[]}
          text={
            '[bb message from thread:thr_sender123; reply with `bb thread tell thr_sender123 "<your response>"`]\n\nLine 1\nLine 2\nLine 3\nLine 4'
          }
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
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

  it("renders system-originated messages as auto-expanded timeline rows and hides the bb prefix", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="system"
        senderThreadId={null}
        senderThreadTitle={null}
        attachments={null}
        mentions={[]}
        text={"[bb system]\n\nScheduled nudge: daily-recap. Check ASYNC.md."}
        turnRequest={{ kind: "message", status: "accepted" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: /System Message/u }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /System Message/u })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    expect(
      screen.getByText("Scheduled nudge: daily-recap. Check ASYNC.md."),
    ).toBeTruthy();
    expect(screen.queryByText(/\[bb system/u)).toBeNull();
  });

  it("renders generated system steer status inside the expanded body", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="system"
        senderThreadId={null}
        senderThreadTitle={null}
        attachments={null}
        mentions={[]}
        text={"[bb system]\n\nScheduled nudge: daily-recap. Check ASYNC.md."}
        turnRequest={{ kind: "steer", status: "pending" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "System Message" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /steer pending/u }),
    ).toBeNull();
    expect(screen.getByText("steer pending")).toBeTruthy();
  });

  it("renders generated agent steer status inside the expanded body", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="agent"
        senderThreadId="thr_sender123"
        senderThreadTitle="Frontend manager"
        attachments={null}
        mentions={[]}
        text={
          '[bb message from thread:thr_sender123; reply with `bb thread tell thr_sender123 "<your response>"`]\n\nAgent-to-agent status update.'
        }
        turnRequest={{ kind: "steer", status: "accepted" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Message from Frontend manager" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /steer/u })).toBeNull();
    expect(screen.queryByText("steer")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Message from Frontend manager" }),
    );

    expect(screen.getByText("steer")).toBeTruthy();
  });

  it("renders mention pills in expanded agent-originated rows with shifted offsets", () => {
    const token = "@thread:thr_target";
    const text = `[bb message from thread:thr_sender123; reply with \`bb thread tell thr_sender123 "<your response>"\`]\n\nAsk ${token} to review.`;
    const start = text.indexOf(token);

    render(
      <MemoryRouter>
        <ConversationMessageContent
          role="user"
          initiator="agent"
          resolveSegmentLinkHref={(link) => {
            switch (link.kind) {
              case "thread":
                return `/projects/proj_current/threads/${link.threadId}`;
            }
          }}
          senderThreadId="thr_sender123"
          senderThreadTitle="Frontend manager"
          attachments={null}
          mentions={[
            {
              start,
              end: start + token.length,
              resource: {
                kind: "thread",
                threadId: "thr_target",
                projectId: "proj_target",
                threadType: "standard",
                label: "API planning",
              },
            },
          ]}
          text={text}
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Message from Frontend manager/u,
      }),
    );

    const mention = screen.getByRole("link", { name: "API planning" });
    expect(mention.getAttribute("href")).toBe(
      "/projects/proj_target/threads/thr_target",
    );
    expect(screen.queryByText(token)).toBeNull();
  });

  it("clips generated message text before a mention that crosses the visible boundary", () => {
    const token = "@partial-generated-thread-token";
    const visibleTokenLength = 8;
    const bodyPrefix = "x".repeat(USER_MESSAGE_CHAR_CAP - visibleTokenLength);
    const text = `[bb message from thread:thr_sender123; reply with \`bb thread tell thr_sender123 "<your response>"\`]\n\n${bodyPrefix}${token} after`;
    const start = text.indexOf(token);

    const { container } = render(
      <MemoryRouter>
        <ConversationMessageContent
          role="user"
          initiator="agent"
          resolveSegmentLinkHref={(link) => {
            switch (link.kind) {
              case "thread":
                return `/projects/proj_current/threads/${link.threadId}`;
            }
          }}
          senderThreadId="thr_sender123"
          senderThreadTitle="Frontend manager"
          attachments={null}
          mentions={[
            {
              start,
              end: start + token.length,
              resource: {
                kind: "thread",
                threadId: "thr_generated_boundary",
                projectId: "proj_generated",
                threadType: "standard",
                label: "Generated boundary thread",
              },
            },
          ]}
          text={text}
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Message from Frontend manager/u,
      }),
    );

    expect(container.textContent).not.toContain(
      token.slice(0, visibleTokenLength),
    );
    expect(
      screen.queryByRole("link", { name: "Generated boundary thread" }),
    ).toBeNull();
  });

  it("renders mention pills in expanded system-originated rows with shifted offsets", () => {
    const token = "@thread:thr_system";
    const text = `[bb system]\n\nAsk ${token} to refresh.`;
    const start = text.indexOf(token);

    render(
      <MemoryRouter>
        <ConversationMessageContent
          role="user"
          initiator="system"
          senderThreadId={null}
          senderThreadTitle={null}
          attachments={null}
          mentions={[
            {
              start,
              end: start + token.length,
              resource: {
                kind: "thread",
                threadId: "thr_system",
                projectId: "proj_system",
                threadType: "manager",
                label: "System manager",
              },
            },
          ]}
          text={text}
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
    );

    const mention = screen.getByRole("link", { name: "System manager" });
    expect(mention.getAttribute("href")).toBe(
      "/projects/proj_system/threads/thr_system",
    );
    expect(screen.queryByText(token)).toBeNull();
  });
});
