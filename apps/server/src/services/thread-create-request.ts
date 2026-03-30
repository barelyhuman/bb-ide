import type { ThreadTurnInitiator } from "@bb/domain";
import type { CreateThreadRequest } from "@bb/server-contract";

export interface PublicThreadCreateServiceRequest extends CreateThreadRequest {
  type: "standard";
  spawnInitiator?: ThreadTurnInitiator;
}

export interface ManagerThreadCreateServiceRequest extends CreateThreadRequest {
  type: "manager";
  spawnInitiator?: ThreadTurnInitiator;
}

export type ThreadCreateServiceRequest =
  | PublicThreadCreateServiceRequest
  | ManagerThreadCreateServiceRequest;
