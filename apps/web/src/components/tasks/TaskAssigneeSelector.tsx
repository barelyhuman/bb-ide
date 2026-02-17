import { useMemo } from "react"
import type { AgentRole } from "@beanbag/core"
import { PromptOptionPicker } from "@/components/promptbox/PromptOptionPicker"
import { useRoles } from "@/hooks/useApi"

const UNASSIGNED_OPTION = {
  id: "",
  name: "Unassigned",
}

const DEFAULT_AGENT_ROLE: AgentRole = {
  id: "agent/generic",
  name: "Generic Agent",
  description: "General-purpose task execution agent.",
  instructions: "General-purpose task execution agent.",
}

interface TaskAssigneeSelectorProps {
  value?: string | null
  onChange: (value: string) => void
  label?: string
  className?: string
}

function resolveRoleOptions(roles: AgentRole[] | undefined): AgentRole[] {
  if (roles && roles.length > 0) return roles
  return [DEFAULT_AGENT_ROLE]
}

export function TaskAssigneeSelector({
  value,
  onChange,
  label = "Task assignee",
  className,
}: TaskAssigneeSelectorProps) {
  const rolesQuery = useRoles()
  const roleOptions = useMemo(
    () => resolveRoleOptions(rolesQuery.data),
    [rolesQuery.data]
  )
  const pickerOptions = useMemo(
    () => [
      { value: UNASSIGNED_OPTION.id, label: UNASSIGNED_OPTION.name },
      ...roleOptions.map((role) => ({
        value: role.id,
        label: role.name,
      })),
    ],
    [roleOptions]
  )
  const selectedValue = useMemo(() => {
    if (typeof value === "string") {
      if (pickerOptions.some((option) => option.value === value)) return value
    }
    return UNASSIGNED_OPTION.id
  }, [pickerOptions, value])

  return (
    <PromptOptionPicker
      label={label}
      value={selectedValue}
      options={pickerOptions}
      onChange={onChange}
      className={className}
    />
  )
}
