import { DEFAULTS } from "./defaults.js";

const MAX_PORT = 65_535;
const MIN_PORT = 1;

export function resolveDevPublicUrl(): string {
  const rawPort = process.env.BB_SERVER_PORT;
  const parsedPort = Number.parseInt(rawPort ?? "", 10);
  const port = Number.isInteger(parsedPort) &&
      parsedPort >= MIN_PORT &&
      parsedPort <= MAX_PORT
    ? parsedPort
    : DEFAULTS.serverPort.dev;
  return `http://localhost:${port}`;
}

export function validateOptionalUrl(name: string, value: string): string {
  if (value.length === 0) {
    return value;
  }
  return validateRequiredUrl(name, value);
}

export function validateRequiredUrl(name: string, value: string): string {
  try {
    void new URL(value);
    return value;
  } catch {
    throw new Error(`${name} must be a valid URL, received "${value}"`);
  }
}
