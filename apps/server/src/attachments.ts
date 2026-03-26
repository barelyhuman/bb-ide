import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { randomBytes } from "node:crypto";
import type { UploadedPromptAttachment } from "@bb/server-contract";
import { ApiError } from "./errors.js";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

function attachmentDir(dataDir: string, projectId: string): string {
  return join(dataDir, "attachments", projectId);
}

export async function storeAttachment(
  dataDir: string,
  projectId: string,
  file: File,
): Promise<UploadedPromptAttachment> {
  const isImage = IMAGE_MIME_TYPES.has(file.type);
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;

  if (file.size > maxSize) {
    throw new ApiError(
      400,
      "invalid_request",
      `File too large: ${file.size} bytes (max ${maxSize})`,
    );
  }

  const dir = attachmentDir(dataDir, projectId);
  mkdirSync(dir, { recursive: true });

  const timestamp = Date.now();
  const suffix = randomBytes(4).toString("hex");
  const ext = extname(file.name);
  const safeName = sanitizeFilename(basename(file.name, ext));
  const filename = `${safeName}_${timestamp}_${suffix}${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = join(dir, filename);
  writeFileSync(filePath, buffer);

  return {
    type: isImage ? "localImage" : "localFile",
    path: filename,
    name: file.name,
    mimeType: file.type || undefined,
    sizeBytes: file.size,
  };
}

export function readAttachment(
  dataDir: string,
  projectId: string,
  path: string,
): string | null {
  // Path traversal protection
  const normalized = basename(path);
  if (normalized !== path || path.includes("..")) {
    return null;
  }

  const filePath = join(attachmentDir(dataDir, projectId), normalized);
  if (!existsSync(filePath)) return null;

  return readFileSync(filePath, "utf-8");
}

export function deleteProjectAttachments(
  dataDir: string,
  projectId: string,
): void {
  const dir = attachmentDir(dataDir, projectId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
