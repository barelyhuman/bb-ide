import { envsafe, port } from "envsafe";
import { DEFAULTS } from "./defaults.js";

export const serverPortConfig = envsafe({
  BB_SERVER_PORT: port({
    desc: "HTTP port for the server",
    default: DEFAULTS.serverPort.prod,
    devDefault: DEFAULTS.serverPort.dev,
  }),
});
