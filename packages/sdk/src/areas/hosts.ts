import type { Host } from "@bb/domain";
import type { CreateSdkAreaArgs } from "./common.js";

export interface HostGetArgs {
  hostId: string;
}

export interface HostsArea {
  get(args: HostGetArgs): Promise<Host>;
  list(): Promise<Host[]>;
}

export function createHostsArea(args: CreateSdkAreaArgs): HostsArea {
  const { transport } = args;
  return {
    async get(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].$get({
          param: { id: input.hostId },
        }),
      );
    },
    async list() {
      return transport.readJson(transport.api.v1.hosts.$get());
    },
  };
}
