/**
 * Reads a required env var and throws an actionable error if it is absent.
 * SODEJA_ARCHITECTURE.md's "free/local first" posture and
 * services/ingestion/README.md both require credentials/inputs to come from
 * env vars with a clear failure — never a hardcoded key, never a silent skip
 * that could be mistaken for "ingested zero rows on purpose".
 */
export function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is not set. ${hint}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}
