import { useState } from "react";
import type { UploadedPromptAttachment } from "@bb/server-contract";
import { ExecutionControls } from "@/components/promptbox/ExecutionControls";
import {
  PromptBoxInternal,
  type HistoryConfig,
  type PromptBoxSubmissionConfig,
  type PromptVoiceConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  makeAttachmentsConfig as makeAttachments,
  makeExecutionControlsProps,
  makeMentionsConfig as makeMentions,
} from "../../../.ladle/story-fixtures";

export default {
  title: "promptbox/Prompt Box Internal",
};

const noop = () => {};

const mockExecution = makeExecutionControlsProps();

// ---------------------------------------------------------------------------
// Voice fixtures — story-only PromptVoiceConfig values for the recording UX.
// ---------------------------------------------------------------------------

const idleVoice: PromptVoiceConfig = {
  state: "idle",
  isSupported: true,
  start: noop,
  stop: noop,
  cancel: noop,
};

const recordingVoice: PromptVoiceConfig = {
  ...idleVoice,
  state: "recording",
};

const transcribingVoice: PromptVoiceConfig = {
  ...idleVoice,
  state: "transcribing",
};

// ---------------------------------------------------------------------------
// Mock attachments
// ---------------------------------------------------------------------------

const mockAttachments: UploadedPromptAttachment[] = [
  {
    type: "localImage",
    path: "https://placecats.com/300/200",
    name: "screenshot.png",
    mimeType: "image/png",
    sizeBytes: 124_000,
  },
  {
    type: "localImage",
    path: "https://placecats.com/320/180",
    name: "design-mock.png",
    mimeType: "image/png",
    sizeBytes: 96_000,
  },
  {
    type: "localFile",
    path: "/uploads/diff.patch",
    name: "diff.patch",
    mimeType: "text/x-patch",
    sizeBytes: 8_400,
  },
];

// ---------------------------------------------------------------------------
// History fixture (Up/Down recall)
// ---------------------------------------------------------------------------

const historyEntries = [
  { text: "fix the timeline pagination bug", attachments: [] },
  { text: "review thread workspace", attachments: [] },
];

const baseHistory: HistoryConfig = {
  currentDraft: { text: "", attachments: [] },
  entries: historyEntries,
  onSelectEntry: noop,
};

// ---------------------------------------------------------------------------
// Per-row controlled value + helpers
// ---------------------------------------------------------------------------

function useControlledValue(initial: string) {
  const [value, setValue] = useState(initial);
  return { value, onChange: setValue };
}

function makeSubmission(
  overrides?: Partial<PromptBoxSubmissionConfig>,
): PromptBoxSubmissionConfig {
  return {
    isSubmitting: false,
    disabled: false,
    title: "Submit (Enter)",
    mode: "enter",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Story rows. Each row is its own controlled instance.
// ---------------------------------------------------------------------------

function DefaultRow() {
  const { value, onChange } = useControlledValue("");
  return (
    <PromptBoxInternal
      value={value}
      onChange={onChange}
      onSubmit={noop}
      mentions={makeMentions()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function WithAttachmentsRow() {
  const { value, onChange } = useControlledValue(
    "Take a look at this screenshot and the diff.",
  );
  return (
    <PromptBoxInternal
      value={value}
      onChange={onChange}
      onSubmit={noop}
      mentions={makeMentions()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments({ items: mockAttachments })}
      history={baseHistory}
      submission={makeSubmission()}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function SubmittingRow() {
  const { value, onChange } = useControlledValue("Review thread workspace.");
  return (
    <PromptBoxInternal
      value={value}
      onChange={onChange}
      onSubmit={noop}
      mentions={makeMentions()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission({
        isSubmitting: true,
        disabled: true,
        title: "Submitting...",
      })}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function RunningWithStopRow() {
  const { value, onChange } = useControlledValue("");
  return (
    <PromptBoxInternal
      value={value}
      onChange={onChange}
      onSubmit={noop}
      placeholder="Ask for a follow-up. @ to mention files or folders"
      mentions={makeMentions()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission({
        isRunning: true,
        onStop: noop,
        title: "Queue follow-up (Enter)",
      })}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function RecordingActiveRow() {
  const { value, onChange } = useControlledValue("");
  return (
    <PromptBoxInternal
      value={value}
      onChange={onChange}
      onSubmit={noop}
      mentions={makeMentions()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={recordingVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function RecordingProcessingRow() {
  const { value, onChange } = useControlledValue("");
  return (
    <PromptBoxInternal
      value={value}
      onChange={onChange}
      onSubmit={noop}
      mentions={makeMentions()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={transcribingVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="default" hint="empty draft, no in-flight state">
        <DefaultRow />
      </StoryRow>
      <StoryRow
        label="with attachments"
        hint="image + file attached to the draft"
      >
        <WithAttachmentsRow />
      </StoryRow>
      <StoryRow label="submitting" hint="mutation in flight">
        <SubmittingRow />
      </StoryRow>
      <StoryRow
        label="running with stop"
        hint="isRunning=true → stop button shown"
      >
        <RunningWithStopRow />
      </StoryRow>
      <StoryRow
        label="recording active"
        hint="voice.state === 'recording' → live waveform + cancel"
      >
        <RecordingActiveRow />
      </StoryRow>
      <StoryRow
        label="recording processing"
        hint="voice.state === 'transcribing' → spinner + cancel"
      >
        <RecordingProcessingRow />
      </StoryRow>
    </StoryCard>
  );
}
