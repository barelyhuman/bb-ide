import { envsafe, invalidEnvError, makeValidator, str } from "envsafe";

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

export const devEnvConfig = envsafe({
  BB_DEV_APP_HOST: str({
    desc: "Development-only Vite bind host for apps/app. Set to 0.0.0.0 to test from phones or other LAN devices. Does not affect production server binding or generated URLs.",
    default: "",
    allowEmpty: true,
    devDefault: "",
  }),
  BB_DEV_APP_PORT: optionalPort({
    desc: "Development-only Vite port for apps/app.",
    default: OPTIONAL_PORT_UNSET,
  }),
  BB_DEV_ENV_PORT: optionalPort({
    desc: "Development-only localhost port for the bb dev-env helper API.",
    default: OPTIONAL_PORT_UNSET,
  }),
});
