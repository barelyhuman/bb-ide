export function toOptionalString(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

export function toOptionalTrimmedString(
  value: string | undefined,
): string | undefined {
  return toOptionalString(value?.trim());
}
