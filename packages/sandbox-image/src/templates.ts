function readConfiguredSandboxImageTemplate(): string | undefined {
  const template = process.env.E2B_TEMPLATE?.trim();
  return template && template.length > 0 ? template : undefined;
}

export function resolveSandboxImageTemplate(): string {
  const template = readConfiguredSandboxImageTemplate();
  if (template) {
    return template;
  }

  throw new Error(
    "Sandbox provisioning requires E2B_TEMPLATE to be configured. Run `pnpm exec turbo run template:build --filter=@bb/sandbox-image` and export the printed template, or set E2B_TEMPLATE directly.",
  );
}
