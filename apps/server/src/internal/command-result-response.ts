import type { HostDaemonCommandResultReport } from "@bb/host-daemon-contract";

type SuccessfulCommandResultReport = Extract<
  HostDaemonCommandResultReport,
  { ok: true }
>;
type FailedCommandResultReport = Extract<
  HostDaemonCommandResultReport,
  { ok: false }
>;

export interface CommandResultSuccessWaiterResponse {
  commandId: string;
  ok: true;
  result: SuccessfulCommandResultReport["result"];
  type: SuccessfulCommandResultReport["type"];
}

export interface CommandResultFailureWaiterResponse {
  commandId: string;
  errorCode: FailedCommandResultReport["errorCode"];
  errorMessage: string;
  ok: false;
  type: string;
}

export type CommandResultWaiterResponse =
  | CommandResultSuccessWaiterResponse
  | CommandResultFailureWaiterResponse;
