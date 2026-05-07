import type { Host } from "@bb/domain";
import { Container, Monitor } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Icon for a host based on its type. Persistent hosts (the user's machine,
 * always-on remotes) get Monitor; ephemeral hosts (E2B sandboxes, etc.) get
 * Container.
 */
export function getHostIcon(host: Host | undefined | null): LucideIcon {
  return host?.type === "ephemeral" ? Container : Monitor;
}
