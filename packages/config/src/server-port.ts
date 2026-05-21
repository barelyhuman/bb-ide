import { envsafe, port } from "envsafe";

const readServerPortConfig = () =>
  envsafe({
    BB_SERVER_PORT: port({
      desc: "HTTP port for the server",
    }),
  });

export const serverPortConfig = {
  get BB_SERVER_PORT() {
    return readServerPortConfig().BB_SERVER_PORT;
  },
};
