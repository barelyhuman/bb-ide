import { useCallback } from "react"
import { useCreateProject } from "@/hooks/useApi"
import {
  deriveProjectNameFromPath,
} from "@/lib/projectPathInput"

export function useQuickCreateProject() {
  const { mutate, isPending } = useCreateProject()

  // TODO: Wire up path picker via useHostDaemon when available.
  // For now this uses window.prompt as a placeholder.
  const createFromPicker = useCallback(async () => {
    if (isPending) return

    const rootPath = window.prompt("Enter project root path:")
    if (!rootPath) return

    const name = deriveProjectNameFromPath(rootPath).trim()
    if (!name || !rootPath) {
      window.alert(
        "Could not read a valid folder path. Please pick or enter a different path."
      )
      return
    }

    // TODO: sourcePath + hostId per CreateProjectRequest schema
    mutate({ name, sourcePath: rootPath, hostId: "" })
  }, [isPending, mutate])

  return { createFromPicker, isCreating: isPending }
}
