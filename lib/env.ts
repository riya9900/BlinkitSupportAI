// Reads an environment variable the way people really paste them into a hosting
// dashboard: stray spaces/newlines and one pair of wrapping quotes are removed,
// and an empty value counts as "not set".
export function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  let value = raw.trim();
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
    value = value.slice(1, -1).trim();
  }
  return value === '' ? undefined : value;
}
