import { envsafe, url } from "envsafe";
import { commonConfig } from "./common.js";

export { commonConfig };

export const hostDaemonConfig = envsafe({
  BB_SERVER_URL: url({
    desc: "URL of the bb server this daemon connects to",
    default: "http://localhost:3000",
    devDefault: "http://localhost:3000",
  }),
});
