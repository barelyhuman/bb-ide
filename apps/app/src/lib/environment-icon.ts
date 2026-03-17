import type { EnvironmentRecord, SystemEnvironmentInfo } from "@bb/core"
import { Container, FolderGit2, Laptop, type LucideIcon } from "lucide-react"

interface EnvironmentIconInfo {
  icon: LucideIcon
  ariaLabel: string
}

type EnvironmentIconSource =
  | (Pick<SystemEnvironmentInfo, "capabilities"> & {
      requestedRuntimeKind?: string
      runtimeState?: { kind: string }
    })
  | Pick<EnvironmentRecord, "managed" | "requestedRuntimeKind" | "runtimeState">

export function getEnvironmentIconInfo(
  environment?: EnvironmentIconSource | null,
): EnvironmentIconInfo | undefined {
  if (!environment) return undefined

  const effectiveKind = environment.requestedRuntimeKind ?? environment.runtimeState?.kind

  if (effectiveKind === "docker") {
    return {
      icon: Container,
      ariaLabel: "Docker thread",
    }
  }

  if ("managed" in environment && environment.managed) {
    return {
      icon: FolderGit2,
      ariaLabel: "Managed environment",
    }
  }

  if (
    ("capabilities" in environment && environment.capabilities.isolated_workspace) ||
    effectiveKind === "worktree"
  ) {
    return {
      icon: FolderGit2,
      ariaLabel: "Worktree thread",
    }
  }

  if (
    ("capabilities" in environment && environment.capabilities.host_filesystem) ||
    ("managed" in environment && !environment.managed)
  ) {
    return {
      icon: Laptop,
      ariaLabel: "Direct thread",
    }
  }

  return undefined
}
