import { cn } from "@/lib/utils"
import { Link, useLocation } from "react-router-dom"
import { Moon, Settings, Sun } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { ProjectList } from "./ProjectList"
import { useQuickCreateProject } from "@/hooks/useQuickCreateProject"
import { useServerConnectionState } from "@/hooks/useWebSocket"
import { setPreferredTheme, usePreferredTheme } from "@/hooks/useTheme"
import { resolveServerStatusIndicatorState } from "@/lib/server-status-indicator"

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  isResizing: boolean
}

export function AppSidebar({ onResizeMouseDown, isResizing }: AppSidebarProps) {
  const location = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const { createFromPicker, isCreating, isAvailable: canCreateProject } = useQuickCreateProject()
  const serverConnectionState = useServerConnectionState()
  const theme = usePreferredTheme()

  const closeOnMobile = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  const isDarkTheme = theme === "dark"
  const toggleTheme = () => {
    setPreferredTheme(isDarkTheme ? "light" : "dark")
  }
  const selectedProjectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1]
  const serverStatus = resolveServerStatusIndicatorState({
    connectionState: serverConnectionState,
    isRestartPending: false,
    shouldRestart: false,
  })

  const serverIndicatorClassName = {
    "up-to-date":
      "bg-emerald-500 ring-emerald-500/25 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]",
    reconnecting:
      "bg-amber-400 ring-amber-400/30 shadow-[0_0_0_4px_rgba(251,191,36,0.18)] animate-pulse",
    "out-of-date":
      "bg-red-500 ring-red-500/25 shadow-[0_0_0_4px_rgba(239,68,68,0.16)]",
  }[serverStatus]

  const serverStatusLabel = {
    "up-to-date": "Connected",
    reconnecting: "Reconnecting...",
    "out-of-date": "Restart required",
  }[serverStatus]

  return (
    <>
      <Sidebar>
        <SidebarContent>
          <ProjectList
            onNewProject={canCreateProject ? () => { void createFromPicker() } : undefined}
            onProjectSelect={closeOnMobile}
            selectedProjectId={selectedProjectId}
            isCreatingProject={isCreating}
          />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu className="flex-row items-center">
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={toggleTheme}
                className="w-8 justify-center p-0"
                tooltip={isDarkTheme ? "Switch to light mode" : "Switch to dark mode"}
                aria-label={isDarkTheme ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDarkTheme ? <Sun /> : <Moon />}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className="w-8 justify-center p-0"
                tooltip="App settings"
                aria-label="App settings"
              >
                <Link to="/settings">
                  <Settings />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="min-w-0 gap-2 rounded-full border border-sidebar-border/70 bg-sidebar/70 px-2 py-1 text-sidebar-foreground/80 shadow-none cursor-default hover:bg-sidebar/70 hover:text-sidebar-foreground/80 active:bg-sidebar/70"
                aria-label={`Server status: ${serverStatusLabel}`}
                title={`Server status: ${serverStatusLabel}`}
              >
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full ring-1 ring-inset transition-all",
                    serverIndicatorClassName,
                  )}
                  aria-hidden
                />
                <span className="truncate text-xs font-medium leading-none">
                  {serverStatusLabel}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <div
          className={cn(
            "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
            "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
            "group-data-[collapsible=icon]:hidden",
            isResizing && "before:bg-sidebar-border"
          )}
          onMouseDown={onResizeMouseDown}
        />
      </Sidebar>
    </>
  )
}
