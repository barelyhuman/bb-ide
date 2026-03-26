export type ThreadTimelineTheme = "light" | "dark";

export interface ThreadTimelineRenderOptions {
  initialExpanded?: boolean;
}

export type UserAttachmentImageSrcResolver = (
  pathOrUrl: string,
  projectId?: string,
) => string;
