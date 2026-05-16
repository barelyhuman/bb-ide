import { envsafe, makeValidator } from "envsafe";
import { hostTypeSchema } from "@bb/domain";
import type { HostType } from "@bb/domain";

export const optionalTrimmedString = makeValidator<string | undefined>(
  (input) => {
    const trimmedInput = input?.trim() ?? "";
    return trimmedInput.length === 0 ? undefined : trimmedInput;
  },
);

export const optionalHostType = makeValidator<HostType | undefined>((input) => {
  const trimmedInput = input?.trim() ?? "";
  if (trimmedInput.length === 0) {
    return undefined;
  }

  const parsedHostType = hostTypeSchema.safeParse(trimmedInput);
  if (!parsedHostType.success) {
    throw new Error(`Invalid BB_HOST_TYPE "${trimmedInput}"`);
  }

  return parsedHostType.data;
});

export const hostDaemonEntrypointConfig = envsafe({
  BB_CLI_DIR: optionalTrimmedString({
    desc: "Directory containing the bb CLI executable to inject into runtime shells",
    default: "",
    allowEmpty: true,
  }),
  BB_BRIDGE_DIR: optionalTrimmedString({
    desc: "Directory containing provider bridge bundles for the host daemon runtime",
    default: "",
    allowEmpty: true,
  }),
  BB_HOST_ENROLL_KEY: optionalTrimmedString({
    desc: "One-time enrollment token used to bootstrap a host daemon with the bb server",
    default: "",
    allowEmpty: true,
  }),
  BB_HOST_ID: optionalTrimmedString({
    desc: "Preferred host ID to persist for the daemon instead of generating one locally",
    default: "",
    allowEmpty: true,
  }),
  BB_HOST_NAME: optionalTrimmedString({
    desc: "Preferred host name to report instead of detecting the local hostname",
    default: "",
    allowEmpty: true,
  }),
  BB_HOST_TYPE: optionalHostType({
    desc: "Host type override for daemon bootstrap",
    default: undefined,
    allowEmpty: true,
    input: process.env.BB_HOST_TYPE ?? "",
  }),
});

export type HostDaemonEntrypointConfig = typeof hostDaemonEntrypointConfig;
