import { useCallback } from "react"
import { useCreateProject } from "@/hooks/useApi"
import { pickProjectFolder } from "@/lib/api"

function normalizeRootPath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^['"]|['"]$/g, "")
  if (!trimmed) {
    return ""
  }

  const normalized = trimmed.replace(/\\/g, "/")
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized
  }

  return normalized.replace(/\/+$/, "")
}

function deriveNameFromPath(path: string): string {
  if (!path || path === "/") {
    return ""
  }

  const segments = path.split("/").filter(Boolean)
  return segments.at(-1) ?? ""
}

async function requestRootPath(): Promise<string | null> {
  try {
    const selected = await pickProjectFolder()
    if (!selected.path) {
      return null
    }
    return normalizeRootPath(selected.path)
  } catch {
    const typed = window.prompt("Enter the full folder path for this project:")
    if (typed == null) {
      return null
    }
    const normalized = normalizeRootPath(typed)
    return normalized || null
  }
}

export function useQuickCreateProject() {
  const { mutate, isPending } = useCreateProject()

  const createFromPicker = useCallback(async () => {
    if (isPending) return

    const rootPath = await requestRootPath()
    if (!rootPath) return

    const name = deriveNameFromPath(rootPath).trim()
    if (!name || !rootPath) {
      window.alert(
        "Could not read a valid folder path. Please pick or enter a different path."
      )
      return
    }

    mutate({ name, rootPath })
  }, [isPending, mutate])

  return { createFromPicker, isCreating: isPending }
}
