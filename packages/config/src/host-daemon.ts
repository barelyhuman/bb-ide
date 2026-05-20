import {
  bool,
  envsafe,
  invalidEnvError,
  makeValidator,
  port,
  str,
  url,
} from "envsafe";
import { commonConfig } from "./common.js";
import { validateOptionalUrl } from "./public-url.js";

export { commonConfig };

const OPTIONAL_PORT_UNSET = 0;

const optionalPort = makeValidator<number | undefined>((input) => {
  if (input === undefined || input === OPTIONAL_PORT_UNSET) {
    return undefined;
  }

  const coerced = +input;
  if (
    Number.isNaN(coerced) ||
    `${coerced}` !== `${input}` ||
    coerced % 1 !== 0 ||
    coerced < 1 ||
    coerced > 65_535
  ) {
    throw invalidEnvError("port", input);
  }
  return coerced;
});

const rawHostDaemonConfig = envsafe({
  BB_SERVER_URL: url({
    desc: "URL of the bb server this daemon connects to",
  }),
  BB_HOST_DAEMON_PORT: port({
    desc: "Port for the host-daemon local API",
  }),
  BB_DEV_APP_PORT: optionalPort({
    desc: "Vite port for the BB app frontend; allowed as a CORS origin for the daemon's local API when set.",
    default: OPTIONAL_PORT_UNSET,
  }),
  BB_APP_URL: str({
    desc: "Public app origin (e.g. https://app.example.com) — allowed as a CORS origin for the daemon's local API when the frontend is served from a non-localhost domain.",
    default: "",
    allowEmpty: true,
  }),
  BB_DEV_REPLAY_CAPTURE: bool({
    desc: "When true, the daemon records live provider traffic as replay captures (development only)",
    default: false,
  }),
});

export const hostDaemonConfig = {
  ...rawHostDaemonConfig,
  BB_APP_URL: validateOptionalUrl("BB_APP_URL", rawHostDaemonConfig.BB_APP_URL),
};
