import { statusDataKeySchema, type StatusDataKey } from "@bb/domain";

export const STATUS_DATA_DIRECTORY_NAME = "STATUS-data";
export const STATUS_DATA_FILE_EXTENSION = ".json";

export function statusDataFileName(key: StatusDataKey): string {
  return `${key}${STATUS_DATA_FILE_EXTENSION}`;
}

export function parseStatusDataFileName(
  fileName: string,
): StatusDataKey | null {
  if (!fileName.endsWith(STATUS_DATA_FILE_EXTENSION)) {
    return null;
  }
  const rawKey = fileName.slice(0, -STATUS_DATA_FILE_EXTENSION.length);
  const parsed = statusDataKeySchema.safeParse(rawKey);
  return parsed.success ? parsed.data : null;
}
