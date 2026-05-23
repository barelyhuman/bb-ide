import { useState } from "react";
import { ProjectSelector, type ProjectSelectorOption } from "./ProjectSelector";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "pickers/Project Selector",
};

const projects: readonly ProjectSelectorOption[] = [
  { id: "proj_bb", name: "bb" },
  { id: "proj_pierre", name: "pierre" },
];

const noop = () => {};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="project selected"
        hint="trigger shows the project name + Folder icon"
      >
        <ProjectSelector projects={projects} value="proj_bb" onChange={noop} />
      </StoryRow>
      <StoryRow
        label="no project selected — required mode"
        hint='allowNoProject=false (default): trigger falls back to the first project so it is never blank'
      >
        <ProjectSelector projects={projects} value={null} onChange={noop} />
      </StoryRow>
      <StoryRow
        label="no project selected — optional mode"
        hint='allowNoProject=true: trigger shows "Work in a project" + FolderPlus icon, menu adds "Don&apos;t work in a project" item'
      >
        <ProjectSelector
          projects={projects}
          value={null}
          onChange={noop}
          allowNoProject
        />
      </StoryRow>
      <StoryRow label="open menu — required mode" hint="defaultOpen + modal=false">
        <ProjectSelectorInteractive />
      </StoryRow>
      <StoryRow
        label="open menu — optional mode"
        hint="includes the no-project item below a separator"
      >
        <ProjectSelectorInteractive allowNoProject />
      </StoryRow>
    </StoryCard>
  );
}

function ProjectSelectorInteractive({
  allowNoProject = false,
}: {
  allowNoProject?: boolean;
}) {
  const [value, setValue] = useState<string | null>("proj_bb");
  return (
    <ProjectSelector
      projects={projects}
      value={value}
      onChange={setValue}
      allowNoProject={allowNoProject}
      defaultOpen
      modal={false}
    />
  );
}
