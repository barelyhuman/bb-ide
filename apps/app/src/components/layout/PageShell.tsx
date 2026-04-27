// Stick-to-bottom behavior is owned by the `use-stick-to-bottom` library. Do
// not reintroduce custom ResizeObserver / MutationObserver / scroll-reconcile
// machinery here. Past regressions: see git log --grep=scroll before
// 2026-04-22.
import type { ReactNode } from "react";
import { StickToBottom, type StickToBottomContext } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";

interface PageShellBaseProps {
  children: ReactNode;
  footer?: ReactNode;
  shellClassName?: string;
  scrollAreaClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  maxWidthClassName?: string;
  footerUsesPromptPadding?: boolean;
}

interface PageShellProps extends PageShellBaseProps {
  scrollBehavior?: "static" | "stick-to-bottom";
}

const SHELL_BLEED_CLASS =
  "-mx-4 -mt-4 flex h-full min-h-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mt-5";
const DEFAULT_MAX_WIDTH_CLASS = "max-w-[760px]";

function renderFooter(
  footer: ReactNode,
  {
    maxWidthClassName,
    footerUsesPromptPadding,
    footerClassName,
  }: {
    maxWidthClassName: string;
    footerUsesPromptPadding: boolean;
    footerClassName?: string;
  },
) {
  if (!footer) return null;
  return (
    <div className="relative shrink-0">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-b from-transparent to-background"
      />
      <div
        className={cn(
          "mx-auto w-full bg-background px-4 pb-4",
          maxWidthClassName,
          footerUsesPromptPadding && "chat-prompt-box",
          footerClassName,
        )}
      >
        {footer}
      </div>
    </div>
  );
}

export function PageShell({
  children,
  footer,
  shellClassName,
  scrollAreaClassName,
  contentClassName,
  footerClassName,
  maxWidthClassName = DEFAULT_MAX_WIDTH_CLASS,
  footerUsesPromptPadding = false,
  scrollBehavior = "static",
}: PageShellProps) {
  const footerElement = renderFooter(footer, {
    maxWidthClassName,
    footerUsesPromptPadding,
    footerClassName,
  });

  if (scrollBehavior === "stick-to-bottom") {
    return (
      <StickToBottom className={cn(SHELL_BLEED_CLASS, shellClassName)}>
        {(ctx: StickToBottomContext) => (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              ref={ctx.scrollRef}
              className={cn(
                "@container/page min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]",
                scrollAreaClassName,
              )}
            >
              <div
                ref={ctx.contentRef}
                className={cn(
                  "mx-auto flex w-full flex-col px-4 pb-4 pt-2",
                  maxWidthClassName,
                  contentClassName,
                )}
              >
                {children}
              </div>
            </div>
            {footerElement}
          </div>
        )}
      </StickToBottom>
    );
  }

  return (
    <div className={cn(SHELL_BLEED_CLASS, shellClassName)}>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            "@container/page min-h-0 flex-1 overflow-y-auto",
            scrollAreaClassName,
          )}
        >
          <div
            className={cn(
              "mx-auto flex w-full flex-col px-4 pb-4 pt-2",
              maxWidthClassName,
              contentClassName,
            )}
          >
            {children}
          </div>
        </div>
        {footerElement}
      </div>
    </div>
  );
}
