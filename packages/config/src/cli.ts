import { envsafe, port, url } from "envsafe";

export const cliConfig = envsafe({
  BB_SERVER_URL: url({
    desc: "URL of the bb server",
  }),
  BB_HOST_DAEMON_PORT: port({
    desc: "Port of the local host daemon",
  }),
});
