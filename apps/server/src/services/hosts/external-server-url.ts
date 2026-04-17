import { BlockList, isIP } from "node:net";
import { ApiError } from "../../errors.js";

const unreachableSandboxExternalUrlBlockList = new BlockList();
unreachableSandboxExternalUrlBlockList.addAddress("0.0.0.0", "ipv4");
unreachableSandboxExternalUrlBlockList.addAddress("127.0.0.1", "ipv4");
unreachableSandboxExternalUrlBlockList.addAddress("::", "ipv6");
unreachableSandboxExternalUrlBlockList.addAddress("::1", "ipv6");
unreachableSandboxExternalUrlBlockList.addSubnet("10.0.0.0", 8, "ipv4");
unreachableSandboxExternalUrlBlockList.addSubnet("169.254.0.0", 16, "ipv4");
unreachableSandboxExternalUrlBlockList.addSubnet("172.16.0.0", 12, "ipv4");
unreachableSandboxExternalUrlBlockList.addSubnet("192.168.0.0", 16, "ipv4");
unreachableSandboxExternalUrlBlockList.addSubnet("fc00::", 7, "ipv6");
unreachableSandboxExternalUrlBlockList.addSubnet("fe80::", 10, "ipv6");

export interface ExternalServerUrlConfig {
  externalUrl?: string;
}

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isReachableExternalServerUrl(externalUrl: string): boolean {
  const parsedUrl = new URL(externalUrl);
  if (parsedUrl.protocol !== "https:") {
    return false;
  }
  const normalizedHostname = normalizeHostname(parsedUrl.hostname);
  const ipVersion = isIP(normalizedHostname);

  if (normalizedHostname === "localhost") {
    return false;
  }
  if (ipVersion === 4) {
    return !unreachableSandboxExternalUrlBlockList.check(
      normalizedHostname,
      "ipv4",
    );
  }
  if (ipVersion === 6) {
    return !unreachableSandboxExternalUrlBlockList.check(
      normalizedHostname,
      "ipv6",
    );
  }
  return true;
}

export function hasConfiguredReachableExternalServerUrl(
  config: ExternalServerUrlConfig,
): boolean {
  return (
    config.externalUrl !== undefined &&
    isReachableExternalServerUrl(config.externalUrl)
  );
}

export function requireReachableExternalServerUrl(
  config: ExternalServerUrlConfig,
): string {
  if (config.externalUrl === undefined) {
    throw new ApiError(
      501,
      "not_configured",
      "Sandbox provisioning requires BB_EXTERNAL_URL to be configured",
    );
  }
  if (new URL(config.externalUrl).protocol !== "https:") {
    throw new ApiError(
      409,
      "invalid_request",
      "Sandbox provisioning requires BB_EXTERNAL_URL to use https",
    );
  }
  if (!isReachableExternalServerUrl(config.externalUrl)) {
    throw new ApiError(
      409,
      "invalid_request",
      "Sandbox provisioning requires BB_EXTERNAL_URL to be reachable from the internet",
    );
  }
  return config.externalUrl;
}
