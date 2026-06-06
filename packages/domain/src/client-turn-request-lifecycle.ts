import { z } from "zod";

export const clientTurnRequestCommandTypeValues = [
  "thread.start",
  "turn.submit",
] as const;
export const clientTurnRequestCommandTypeSchema = z.enum(
  clientTurnRequestCommandTypeValues,
);
export type ClientTurnRequestCommandType = z.infer<
  typeof clientTurnRequestCommandTypeSchema
>;

export const clientTurnRequestStatusValues = [
  "pending",
  "accepted",
  "failed",
  "canceled",
  "expired",
] as const;
export const clientTurnRequestStatusSchema = z.enum(
  clientTurnRequestStatusValues,
);
export type ClientTurnRequestStatus = z.infer<
  typeof clientTurnRequestStatusSchema
>;

export const terminalClientTurnRequestStatusValues = [
  "accepted",
  "failed",
  "canceled",
  "expired",
] as const;
export const terminalClientTurnRequestStatusSchema = z.enum(
  terminalClientTurnRequestStatusValues,
);
export type TerminalClientTurnRequestStatus = z.infer<
  typeof terminalClientTurnRequestStatusSchema
>;

export const clientTurnRequestTerminalReasonValues = [
  "accepted",
  "command_succeeded",
  "command_failed",
  "command_expired",
  "runtime_canceled",
  "provider_detached",
  "provider_restarted",
] as const;
export const clientTurnRequestTerminalReasonSchema = z.enum(
  clientTurnRequestTerminalReasonValues,
);
export type ClientTurnRequestTerminalReason = z.infer<
  typeof clientTurnRequestTerminalReasonSchema
>;
