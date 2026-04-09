import type {
  CloudAuthAttemptResponse,
  CloudAuthConnectResponse,
  CloudAuthConnection,
  CloudAuthProviderId,
} from "@bb/server-contract";
import type { StoredCloudAuthCredential } from "./provider-definitions.js";

export interface CloudAuthResolvedCredential<
  TCredential extends StoredCloudAuthCredential = StoredCloudAuthCredential,
> {
  credential: TCredential;
  label: string | null;
  lastErrorMessage: string | null;
  lastRefreshedAt: number | null;
  providerId: TCredential["providerId"];
  updatedAt: number;
}

export interface GetCloudAuthAttemptArgs {
  attemptId: string;
}

export interface StartCloudAuthConnectionArgs {
  providerId: CloudAuthProviderId;
}

export interface DisconnectCloudAuthProviderArgs {
  providerId: CloudAuthProviderId;
}

export interface GetCloudAuthCredentialArgs {
  providerId: CloudAuthProviderId;
}

export interface CloudAuthService {
  disconnectProvider(args: DisconnectCloudAuthProviderArgs): Promise<boolean>;
  dispose(): Promise<void>;
  getAttempt(args: GetCloudAuthAttemptArgs): CloudAuthAttemptResponse | null;
  getValidCredential(
    args: GetCloudAuthCredentialArgs,
  ): Promise<CloudAuthResolvedCredential | null>;
  listConnections(): Promise<CloudAuthConnection[]>;
  startConnection(
    args: StartCloudAuthConnectionArgs,
  ): Promise<CloudAuthConnectResponse>;
}
