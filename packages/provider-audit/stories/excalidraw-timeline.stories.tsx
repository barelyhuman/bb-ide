import type { Story } from "@ladle/react";
import {
  ConversationTimeline,
  ThreadTimelineRows,
} from "@bb/ui-core";
import { fixtureStoryData } from "../.ladle/fixture-story-data";

const EMPTY_LOADING_IDS = new Set<string>();
const EMPTY_TOOL_GROUP_MESSAGES: Record<string, never[]> = {};

type FixtureStoryId =
  | "excalidraw/claude-code/search-bugfix"
  | "excalidraw/claude-code/search-feature"
  | "excalidraw/claude-code/ttd-explanation"
  | "excalidraw/codex/search-bugfix"
  | "excalidraw/codex/search-feature"
  | "excalidraw/codex/ttd-explanation"
  | "excalidraw/pi/search-bugfix"
  | "excalidraw/pi/search-feature"
  | "excalidraw/pi/ttd-explanation";

function findFixture(fixtureId: FixtureStoryId) {
  const fixture = fixtureStoryData.fixtures.find((candidate) => candidate.id === fixtureId);
  if (!fixture) {
    throw new Error(`Missing fixture story data for ${fixtureId}`);
  }
  return fixture;
}

function FixtureTimeline({ fixtureId }: { fixtureId: FixtureStoryId }) {
  const fixture = findFixture(fixtureId);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 px-6 py-8">
      <header className="space-y-1 rounded-md border border-border/70 bg-card/60 px-4 py-3">
        <p className="font-mono ui-text-xs text-muted-foreground">
          {fixture.providerId} / {fixture.taskId}
        </p>
        <h1 className="text-lg font-semibold text-foreground">{fixture.scenarioDescription}</h1>
        <p className="text-sm text-muted-foreground">
          {fixture.viewMessageCount} messages across {fixture.timelineRowCount} rows
        </p>
      </header>
      <ConversationTimeline className="gap-2">
        <ThreadTimelineRows
          latestActivityRowId={fixture.latestActivityRowId}
          loadingToolGroupIds={EMPTY_LOADING_IDS}
          onLoadToolGroupMessages={() => {}}
          themeType="dark"
          threadDetailRows={fixture.timelineRows}
          threadStatus={fixture.threadStatus}
          toolGroupMessagesById={EMPTY_TOOL_GROUP_MESSAGES}
        />
      </ConversationTimeline>
    </div>
  );
}

export default {
  title: "Excalidraw Timeline",
};

export const ClaudeCodeExplanation: Story = () => (
  <FixtureTimeline fixtureId="excalidraw/claude-code/ttd-explanation" />
);

export const ClaudeCodeFeature: Story = () => (
  <FixtureTimeline fixtureId="excalidraw/claude-code/search-feature" />
);

export const ClaudeCodeBugfix: Story = () => (
  <FixtureTimeline fixtureId="excalidraw/claude-code/search-bugfix" />
);

export const CodexExplanation: Story = () => (
  <FixtureTimeline fixtureId="excalidraw/codex/ttd-explanation" />
);

export const CodexFeature: Story = () => (
  <FixtureTimeline fixtureId="excalidraw/codex/search-feature" />
);

export const CodexBugfix: Story = () => (
  <FixtureTimeline fixtureId="excalidraw/codex/search-bugfix" />
);

export const PiExplanation: Story = () => (
  <FixtureTimeline fixtureId="excalidraw/pi/ttd-explanation" />
);

export const PiFeature: Story = () => (
  <FixtureTimeline fixtureId="excalidraw/pi/search-feature" />
);

export const PiBugfix: Story = () => (
  <FixtureTimeline fixtureId="excalidraw/pi/search-bugfix" />
);
