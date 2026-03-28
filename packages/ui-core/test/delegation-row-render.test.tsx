import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ViewDelegationMessage, ViewMessage } from "@bb/domain";
import { DelegationRow } from "../src/thread-timeline/rows/DelegationRow.js";

function renderMessage(message: ViewMessage) {
  return <div data-kind={message.kind}>{message.kind}</div>;
}

function baseDelegationMessage(): ViewDelegationMessage {
  return {
    kind: "delegation",
    id: "delegation-1",
    threadId: "thread-1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    createdAt: 1,
    startedAt: 1,
    turnId: "turn-1",
    toolName: "Agent",
    callId: "agent-1",
    status: "completed",
    children: [],
  };
}

describe("DelegationRow rendering", () => {
  it("renders structured subagent fields without relying on command parsing", () => {
    const html = renderToStaticMarkup(
      <DelegationRow
        message={{
          ...baseDelegationMessage(),
          subagentType: "Explore",
          description: "Inspect the docs tree",
        }}
        renderMessage={renderMessage}
      />,
    );

    expect(html).toContain("Subagent");
    expect(html).toContain("Explore: Inspect the docs tree");
  });

  it("renders subagent output as markdown", () => {
    const html = renderToStaticMarkup(
      <DelegationRow
        message={{
          ...baseDelegationMessage(),
          subagentType: "Explore",
          description: "Inspect the docs tree",
          output: "## Findings\n\n- alpha",
        }}
        initialExpanded={true}
        renderMessage={renderMessage}
      />,
    );

    expect(html).toContain("<h2>Findings</h2>");
    expect(html).toContain('<li class="mb-1 text-foreground">alpha</li>');
  });
});
