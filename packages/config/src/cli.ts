import { envsafe, port, url } from "envsafe";
import { commonConfig } from "./common.js";

export { commonConfig };

export const cliConfig = envsafe({
  BB_SERVER_URL: url({
    desc: "URL of the bb server",
    default: "http://localhost:3000",
    devDefault: "http://localhost:3000",
  }),
  BB_HOST_DAEMON_PORT: port({
    desc: "Port of the local host daemon",
    default: 3001,
    devDefault: 3001,
  }),
});
