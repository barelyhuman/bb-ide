import { useState } from "react";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { StoryCard, StoryRow } from "../../.ladle/story-card";
import {
  LocalOpenTargetSettingsSection,
  type LocalOpenTargetSettingsSectionProps,
} from "./AppSettingsView";

export default {
  title: "settings/Open File Preferences",
};

type StoredTargetId = LocalOpenTargetSettingsSectionProps["directoryTargetId"];

interface LocalOpenTargetSettingsStoryProps {
  initialDirectoryTargetId?: StoredTargetId;
  initialFileTargetId?: StoredTargetId;
  hasDaemon: boolean;
  targets: WorkspaceOpenTarget[];
}

const vscodeTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "vscode",
  label: "VS Code",
};

const finderTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "finder",
  label: "Finder",
};

const terminalTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "terminal",
  label: "Terminal",
};

const defaultAppTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: false,
  },
  id: "default-app",
  label: "Default App",
};

const connectedTargets: WorkspaceOpenTarget[] = [
  vscodeTarget,
  finderTarget,
  terminalTarget,
  defaultAppTarget,
];

function LocalOpenTargetSettingsStory({
  hasDaemon,
  initialDirectoryTargetId = null,
  initialFileTargetId = null,
  targets,
}: LocalOpenTargetSettingsStoryProps) {
  const [directoryTargetId, setDirectoryTargetId] = useState<StoredTargetId>(
    initialDirectoryTargetId,
  );
  const [fileTargetId, setFileTargetId] =
    useState<StoredTargetId>(initialFileTargetId);

  function handleDirectoryTargetChange(targetId: WorkspaceOpenTargetId): void {
    setDirectoryTargetId(targetId);
  }

  function handleFileTargetChange(targetId: WorkspaceOpenTargetId): void {
    setFileTargetId(targetId);
  }

  return (
    <LocalOpenTargetSettingsSection
      directoryTargetId={directoryTargetId}
      fileTargetId={fileTargetId}
      hasDaemon={hasDaemon}
      onDirectoryTargetChange={handleDirectoryTargetChange}
      onFileTargetChange={handleFileTargetChange}
      targets={targets}
    />
  );
}

export function Overview() {
  return (
    <StoryCard labelWidth="180px" className="max-w-5xl">
      <StoryRow
        label="connected"
        hint="directory and file defaults resolve from available targets"
      >
        <div className="w-full max-w-3xl">
          <LocalOpenTargetSettingsStory
            hasDaemon={true}
            targets={connectedTargets}
          />
        </div>
      </StoryRow>
      <StoryRow label="disconnected" hint="menus explain unavailable changes">
        <div className="w-full max-w-3xl">
          <LocalOpenTargetSettingsStory
            hasDaemon={false}
            initialDirectoryTargetId="finder"
            initialFileTargetId="default-app"
            targets={[]}
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}
