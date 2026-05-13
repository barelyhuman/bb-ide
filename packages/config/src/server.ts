import { envsafe, num, port, str } from "envsafe";
import { commonConfig } from "./common.js";
import { databaseConfig } from "./database.js";
import { DEFAULTS } from "./defaults.js";
import { featureFlags } from "./feature-flags.js";
import { validateOptionalUrl } from "./public-url.js";
import { serverPortConfig } from "./server-port.js";

export { commonConfig };

function validateInferenceModel(value: string): string {
  if (/^[^/]+\/[^/]+$/u.test(value)) {
    return value;
  }
  throw new Error(
    `BB_INFERENCE_MODEL must use provider/model format, received "${value}"`,
  );
}

const rawServerConfig = envsafe({
  BB_HOST_DAEMON_PORT: port({
    desc: "Port the host daemon listens on for local API requests",
    default: DEFAULTS.hostDaemonPort.prod,
    devDefault: DEFAULTS.hostDaemonPort.dev,
  }),
  BB_APP_URL: str({
    desc: "Human-facing app/server base URL used for generated links and allowed browser origins. Does not control which host or port the server binds to.",
    default: "",
    allowEmpty: true,
  }),
  BB_EXTERNAL_URL: str({
    desc: "Internet-facing HTTPS base URL used by sandbox hosts and externally reachable auth flows. Does not control which host or port the server binds to.",
    default: "",
    allowEmpty: true,
  }),
  E2B_API_KEY: str({
    desc: "E2B API key for ephemeral sandbox provisioning (optional)",
    default: "",
    allowEmpty: true,
  }),
  E2B_TEMPLATE: str({
    desc: "E2B sandbox template ID (optional)",
    default: "",
    allowEmpty: true,
  }),
  BB_GITHUB_PAT: str({
    desc: "GitHub personal access token used for authenticated repo clones in sandboxes",
    default: "",
    allowEmpty: true,
  }),
  BB_INFERENCE_MODEL: str({
    desc: "Inference model used for server-side completions in provider/model format",
    default: DEFAULTS.inferenceModel,
    devDefault: DEFAULTS.inferenceModel,
  }),
  OPENAI_API_KEY: str({
    desc: "OpenAI API key used for voice transcription and OpenAI-backed inference (optional)",
    default: "",
    allowEmpty: true,
    devDefault: "",
  }),
  ANTHROPIC_API_KEY: str({
    desc: "Anthropic API key used for Claude-backed sandbox runtimes (optional)",
    default: "",
    allowEmpty: true,
    devDefault: "",
  }),
  BB_SANDBOX_ACTIVITY_EXTENSION_DEBOUNCE_MS: num({
    desc: "Debounce window for extending ephemeral sandbox TTL on activity",
    default: DEFAULTS.sandboxActivityExtensionDebounceMs,
    devDefault: DEFAULTS.sandboxActivityExtensionDebounceMs,
  }),
  BB_SANDBOX_IDLE_THRESHOLD_MS: num({
    desc: "Idle time before the server suspends an ephemeral sandbox",
    default: DEFAULTS.sandboxIdleThresholdMs,
    devDefault: DEFAULTS.sandboxIdleThresholdMs,
  }),
});

export const serverConfig = {
  ...databaseConfig,
  ...rawServerConfig,
  ...serverPortConfig,
  featureFlags,
  BB_APP_URL: validateOptionalUrl("BB_APP_URL", rawServerConfig.BB_APP_URL),
  BB_EXTERNAL_URL: validateOptionalUrl(
    "BB_EXTERNAL_URL",
    rawServerConfig.BB_EXTERNAL_URL,
  ),
  BB_INFERENCE_MODEL: validateInferenceModel(
    rawServerConfig.BB_INFERENCE_MODEL,
  ),
};
