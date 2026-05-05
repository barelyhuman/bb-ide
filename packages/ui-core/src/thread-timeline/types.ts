import type {
  MarkdownPreviewLocalFileLink,
  MarkdownPreviewLocalFileLinkHandler,
} from "../primitives/markdown-preview.js";

export type ThreadTimelineTheme = "light" | "dark";

export type ThreadTimelineLocalFileLink = MarkdownPreviewLocalFileLink;

export type ThreadTimelineLocalFileLinkHandler =
  MarkdownPreviewLocalFileLinkHandler;

export type UserAttachmentImageSrcResolver = (
  pathOrUrl: string,
  projectId?: string,
) => string;
