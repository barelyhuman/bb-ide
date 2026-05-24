/**
 * Drops the brand prefix from a model label once provider context is
 * unambiguous (the trigger shows the provider icon; the menu shows provider
 * tabs above the model list). "Sonnet 4.6" / "5.5" reads cleaner than
 * "Claude Sonnet 4.6" / "GPT-5.5".
 *
 * Lives at the picker's render site rather than in `formatModelLabel` so
 * stories — which hand picker labels in directly — see the same trigger and
 * menu output as production paths that go through the formatter.
 */
export function stripModelBrandPrefix(
  label: string,
  providerId: string,
): string {
  switch (providerId) {
    case "claude-code":
      return label.replace(/^Claude\s+/i, "");
    case "codex":
      return label.replace(/^GPT-/i, "");
    default:
      return label;
  }
}
