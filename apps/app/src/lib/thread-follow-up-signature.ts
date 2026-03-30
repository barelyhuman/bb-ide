import type { PromptInput, TimelineRow, ViewUserMessage } from "@bb/domain"
import { collectPromptAttachments } from "./prompt-attachments"

type AttachmentsSignature = NonNullable<ViewUserMessage["attachments"]>

function normalizeAttachmentsSignature(
  attachments: AttachmentsSignature | null | undefined,
): AttachmentsSignature | null {
  if (!attachments) {
    return null
  }

  const imageUrls = attachments.imageUrls?.filter((entry) => entry.trim().length > 0) ?? []
  const localImagePaths =
    attachments.localImagePaths?.filter((entry) => entry.trim().length > 0) ?? []
  const localFilePaths =
    attachments.localFilePaths?.filter((entry) => entry.trim().length > 0) ?? []

  if (
    attachments.webImages === 0 &&
    attachments.localImages === 0 &&
    attachments.localFiles === 0 &&
    imageUrls.length === 0 &&
    localImagePaths.length === 0 &&
    localFilePaths.length === 0
  ) {
    return null
  }

  return {
    webImages: attachments.webImages,
    localImages: attachments.localImages,
    localFiles: attachments.localFiles,
    ...(imageUrls.length > 0 ? { imageUrls } : {}),
    ...(localImagePaths.length > 0 ? { localImagePaths } : {}),
    ...(localFilePaths.length > 0 ? { localFilePaths } : {}),
  }
}

function buildFollowUpText(input: PromptInput[]): string {
  return input
    .filter((entry): entry is Extract<PromptInput, { type: "text" }> => entry.type === "text")
    .map((entry) => entry.text.trim())
    .filter((entry) => entry.length > 0)
    .join("\n\n")
}

function buildFollowUpSignature(text: string, attachments: AttachmentsSignature | null): string {
  return JSON.stringify({
    text,
    attachments,
  })
}

export function buildFollowUpSignatureFromInput(input: PromptInput[]): string {
  return buildFollowUpSignature(
    buildFollowUpText(input),
    collectPromptAttachments(input) ?? null,
  )
}

function getUserMessageAttachmentsSignature(
  message: ViewUserMessage,
): AttachmentsSignature | null {
  return normalizeAttachmentsSignature(message.attachments)
}

export function buildFollowUpSignatureFromRow(row: TimelineRow): string | null {
  if (row.kind !== "message" || row.message.kind !== "user") {
    return null
  }

  return buildFollowUpSignature(
    row.message.text,
    getUserMessageAttachmentsSignature(row.message),
  )
}
