import { envsafe, port } from "envsafe";

export const serverPortConfig = envsafe({
  BB_SERVER_PORT: port({
    desc: "HTTP port for the server",
  }),
});
